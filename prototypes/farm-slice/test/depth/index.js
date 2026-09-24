// Node 24 treats a directory argument to --test as a module entry point.
// This entry makes `node --test prototypes/farm-slice/test/depth/` run the suite.
import './orders.test.mjs';
import './breeding.test.mjs';
import './help-along.test.mjs';
import './gifts.test.mjs';
