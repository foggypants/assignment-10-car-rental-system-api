require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

// Render sits behind a proxy; this makes req.ip / protocol correct.
app.set('trust proxy', 1);

// CORS_ORIGIN: optional comma-separated allowed origins (e.g. your frontend URL). Defaults to allow all.
const origins = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors(origins.length ? { origin: origins } : undefined));
app.use(express.json());

app.get('/', (req, res) => res.json({ service: 'Car Rental & Fleet Booking API', status: 'ok' }));
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime() })); // Render health check

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/vehicles', require('./routes/vehicleRoutes'));
app.use('/api/rentals', require('./routes/rentalRoutes'));

app.use(notFound);
app.use(errorHandler);

// Render injects PORT; bind to 0.0.0.0 so the platform can reach the service.
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, '0.0.0.0', () => console.log(`Car Rental API listening on port ${PORT}`));

// Graceful shutdown on redeploys
process.on('SIGTERM', () => server.close(() => process.exit(0)));
