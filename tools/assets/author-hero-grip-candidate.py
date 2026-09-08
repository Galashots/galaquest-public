"""Author the optional right-hand grip candidate from the public Hero FBX.

Blender 5.2: blender --background --factory-startup --python
 tools/assets/author-hero-grip-candidate.py [-- --render]

Writes only .local/m2/hero-grip-candidate. The canonical FBX is immutable.
This derivative uses the original character licence; it is not promoted.
Owner-supplied grip photographs establish the curl and thumb convention;
the personal photographs are deliberately not copied into the repository.
"""
import sys
import bpy
import hashlib
import json
import math
from pathlib import Path
from mathutils import Vector, Matrix

root=Path(__file__).resolve().parents[2]
out=root/'.local/m2/hero-grip-candidate';out.mkdir(parents=True,exist_ok=True)
source=root/'unity/GalaQuest/Assets/GalaQuest/Migration/SourceAssets/VisibleArmor/Hero.fbx'
source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
if source_hash!='23c161a6a7045987f54b2dae370d02c665d169aefa0c8b6377ca5ee82c893351':
    raise RuntimeError('Hero source changed; requalify the grip recipe')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(source),use_anim=False)
mesh=next(obj for obj in bpy.data.objects if obj.type=='MESH' and obj.vertex_groups.get('RightHand'))
for modifier in mesh.modifiers:
    if modifier.type=='ARMATURE':modifier.show_render=False;modifier.show_viewport=False
group=mesh.vertex_groups['RightHand'].index
source_points=[v.co.copy() for v in mesh.data.vertices]
eligible={v.index for v in mesh.data.vertices if any(g.group==group and g.weight>=.5 for g in v.groups)}
def smooth(a,b,x):
    t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)
digits=[
    {'name':'little','root':(-56.5,3.5,98.2),'direction':(-.97,.24,0),'length':7,'bend':155},
    {'name':'ring','root':(-58,.1,99.6),'direction':(-.995,.1,0),'length':8,'bend':165},
    {'name':'middle','root':(-58,-3.2,100.3),'direction':(-.995,-.1,0),'length':10,'bend':170},
    {'name':'index','root':(-56.5,-6.5,100),'direction':(-.975,-.22,0),'length':11,'bend':160},
    {'name':'thumb','root':(-55.0,-10.3,95.3),'direction':(-.95,-.31,0),'length':5,'bend':20,'yaw':-45},
]
for digit in digits:
    digit['root']=Vector(digit['root']);digit['direction']=Vector(digit['direction']).normalized()
    digit['side']=Vector((-digit['direction'].y,digit['direction'].x,0))
def choose_digit(p):
    choices=[]
    for digit in digits:
        v=p-digit['root'];along=v.dot(digit['direction']);side=abs(v.dot(digit['side']))
        if along>0 and along<digit['length']+3:
            # Include the complete cross section: narrow side cutoffs leave spikes.
            choices.append((side+max(0,abs(v.z)-2),digit))
    return min(choices,key=lambda pair:pair[0])[1] if choices else None
assignments={index:choose_digit(source_points[index]) for index in eligible}
for digit in digits:
    assigned=[source_points[i] for i,d in assignments.items() if d is digit]
    digit['maxAlong']=max((p-digit['root']).dot(digit['direction']) for p in assigned)
    digit['radius']=digit['maxAlong']/math.radians(digit['bend'])
def grip(p,digit):
    if digit is None:return p.copy()
    v=p-digit['root'];along=v.dot(digit['direction']);side=v.dot(digit['side']);height=v.z
    radius=digit['radius'];angle=max(0,along)/radius
    local=digit['direction']*((radius+height)*math.sin(angle))+digit['side']*side
    local.z=-radius+(radius+height)*math.cos(angle)
    if digit.get('yaw'):local=Matrix.Rotation(math.radians(digit['yaw'])*smooth(0,4,along),3,'Z')@local
    posed=digit['root']+local
    return posed


def grip_continuous(p):
    choices=[]
    for d in digits:
        v=p-d['root'];along=v.dot(d['direction'])
        score=abs(v.dot(d['side']))+max(0,abs(v.z)-2)+max(0,-along)
        choices.append((score,p if along<=0 else grip(p,d)))
    low=min(s for s,_ in choices);total=0;result=Vector()
    for score,posed in choices:
        w=math.exp(-4*(score-low));total+=w;result+=posed*w
    return result/total

def jacobian(p):
    columns=[]
    for axis in range(3):
        d=Vector();d[axis]=.002
        columns.append((grip_continuous(p+d)-grip_continuous(p-d))/.004)
    return Matrix(columns).transposed()

patch=[];determinants=[]
for i in sorted(eligible):
    p=source_points[i];posed=grip_continuous(p)
    # Restrict the repair to the already-authored finger region; protect wrist.
    if assignments[i] is None:continue
    j=jacobian(p);determinants.append(j.determinant())
    patch.append({'source':list(p),'candidate':list(posed),'jacobian':[list(row) for row in j]})
changed={tuple(round(c,4) for c in p['source']) for p in patch}
def authored(p):return tuple(round(c,4) for c in p) in changed
mesh.data.calc_loop_triangles();verts=[];faces=[];inverted=[];refined=0
surface=[];surface_faces=[];uv_checks=[];surface_lookup={}
group_names={g.index:g.name for g in mesh.vertex_groups}
source_uv=mesh.data.uv_layers.active.data
for tri in mesh.data.loop_triangles:
    points=[source_points[i] for i in tri.vertices]
    active=any(authored(p) for p in points)
    n=4 if active else 1
    corners=[mesh.data.corner_normals[i].vector.copy() for i in tri.loops]
    uvs=[source_uv[i].uv.copy() for i in tri.loops]
    weights=[{group_names[g.group]:g.weight for g in mesh.data.vertices[i].groups} for i in tri.vertices]
    if active:
        uv_checks.extend({'source':list(p),'uv':list(uv)} for p,uv in zip(points,uvs))
    if active:refined+=1
    grid={};oldgrid={}
    for a in range(n+1):
        for b in range(n+1-a):
            p=points[0]*(1-(a+b)/n)+points[1]*(a/n)+points[2]*(b/n)
            q=grip_continuous(p) if active else p
            grid[a,b]=len(verts);oldgrid[grid[a,b]]=p;verts.append(q)
            if active:
                j=jacobian(p);determinants.append(j.determinant())
                factors=[1-(a+b)/n,a/n,b/n]
                normal=(j.inverted().transposed()@sum((c*w for c,w in zip(corners,factors)),Vector())).normalized()
                uv=uvs[0]*factors[0]+uvs[1]*factors[1]+uvs[2]*factors[2]
                skin={}
                for source_skin,factor in zip(weights,factors):
                    for bone,weight in source_skin.items():skin[bone]=skin.get(bone,0)+weight*factor
                surface_lookup[grid[a,b]]=len(surface)
                surface.append({'position':list(q),'normal':list(normal),'uv':list(uv),'weights':skin})
    for a in range(n):
        for b in range(n-a):
            parts=[(grid[a,b],grid[a+1,b],grid[a,b+1])]
            if a+b<n-1:parts.append((grid[a+1,b],grid[a+1,b+1],grid[a,b+1]))
            for face in parts:
                faces.append(face)
                if active:
                    surface_faces.append([surface_lookup[i] for i in face])
                    p=[oldgrid[i] for i in face];q=[verts[i] for i in face]
                    before=(p[1]-p[0]).cross(p[2]-p[0]);after=(q[1]-q[0]).cross(q[2]-q[0])
                    if before.length>1e-5:
                        expected=jacobian(sum(p,Vector())/3).inverted().transposed()@before
                        if expected.dot(after)<0:inverted.append({'center':list(sum(p,Vector())/3),'area':after.length*.5})
candidate=bpy.data.meshes.new('Locally refined grip diagnostic');candidate.from_pydata(verts,[],faces);candidate.update()
mesh.data=candidate
report={'status':'DRAFT_NOT_REVIEWED','sourceSha256':source_hash,'refinementDivisions':4,
        'deformation':'continuous-cylinder-v1','sourceVertexCount':len(source_points),
        'refinedSourceTriangles':refined,'addedTriangles':refined*15,'minimumJacobianDeterminant':min(determinants),
        'oppositeFacingTriangles':len(inverted),'invertedCenters':inverted,
        'digits':[{'name':d['name'],'root':list(d['root']),'direction':list(d['direction']),
                   'radius':d['radius'],'yaw':d.get('yaw',0)} for d in digits],
        'gripGuide':{'center':[-58.2,-1,96.0],'axis':[0,1,0],'radius':1.3},'patch':patch,
        'surfaceVertices':surface,'surfaceTriangles':surface_faces,'sourceUvChecks':uv_checks}
(out/'right-hand-grip-v1.json').write_text(json.dumps(report,separators=(',',':'))+'\n')

if '--render' in sys.argv:
    material=bpy.data.materials.new('Hand candidate clay');material.diffuse_color=(.56,.61,.67,1)
    material.use_nodes=True;material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.56,.61,.67,1)
    mesh.data.materials.clear();mesh.data.materials.append(material)
    for face in mesh.data.polygons:face.material_index=0
    bpy.context.view_layer.objects.active=mesh;mesh.select_set(True)
    if mesh.data.has_custom_normals:bpy.ops.mesh.customdata_custom_splitnormals_clear()
    guide_center=mesh.matrix_world@Vector(report['gripGuide']['center'])
    bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=.013,depth=.15,location=guide_center,rotation=(math.pi/2,0,0))
    guide=bpy.context.object;guide.name='Diagnostic grip cylinder - not hero geometry'
    guide_mat=bpy.data.materials.new('Grip guide');guide_mat.diffuse_color=(.25,.065,.015,1);guide.data.materials.append(guide_mat)
    guide_mat.use_nodes=True;guide_mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.25,.065,.015,1)
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16
    scene.render.resolution_x=700;scene.render.resolution_y=700;scene.render.resolution_percentage=100
    scene.world=bpy.data.worlds.new('Hand candidate world');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.18,.18,.18,1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.5
    scene.view_settings.view_transform='Standard'
    camera_data=bpy.data.cameras.new('GripInspection');camera=bpy.data.objects.new('GripInspection',camera_data)
    scene.collection.objects.link(camera);scene.camera=camera;camera_data.type='ORTHO';camera_data.ortho_scale=.235
    center=guide_center
    for name,offset,energy,size in [('key',(0,-.4,.5),3,.4),('fill',(.3,.3,.1),1.5,.3)]:
        data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size
        light=bpy.data.objects.new(name,data);scene.collection.objects.link(light);light.location=center+Vector(offset)
        light.rotation_euler=(center-light.location).to_track_quat('-Z','Y').to_euler()
    for name,offset in {'top':(0,0,.5),'palm':(0,0,-.5),'fingers':(-.5,0,.12)}.items():
        camera.location=center+Vector(offset);camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler()
        scene.render.filepath=str(out/('grip-v1-'+name+'.png'));bpy.ops.render.render(write_still=True)
    print(json.dumps({k:v for k,v in report.items() if k not in ('patch','surfaceVertices','surfaceTriangles','sourceUvChecks')}))
    
else:
    print(json.dumps({k:v for k,v in report.items() if k not in ('patch','surfaceVertices','surfaceTriangles','sourceUvChecks')}))
