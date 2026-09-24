const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const c = require('../controllers/rentalController');

router.use(requireAuth);

router.post('/', c.createRental);
router.get('/my-bookings', c.myBookings); // declared before any /:id route
router.patch('/:id/cancel', c.cancelRental);
router.patch('/:id/complete', c.completeRental);

module.exports = router;
