const router = require('express').Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const c = require('../controllers/vehicleController');

router.get('/', c.listVehicles);
router.get('/:id', c.getVehicle);
router.post('/', requireAuth, requireAdmin, c.createVehicle);
router.put('/:id', requireAuth, requireAdmin, c.updateVehicle);
router.delete('/:id', requireAuth, requireAdmin, c.deleteVehicle);

module.exports = router;
