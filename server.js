const path = require('path');
require('dotenv').config({
	path: path.join(__dirname, '.env'),
});

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const webhookRouter = require('./routes/webhook');
const {
	isFirebaseConfigured,
	savePendingSubscription,
} = require('./services/firebaseService');

const app = express();
const port = Number(process.env.PORT || 3000);

if (!process.env.PAYSTACK_SECRET_KEY) {
	throw new Error('PAYSTACK_SECRET_KEY is missing from backend/.env');
}

app.set('trust proxy', 1);
app.use(helmet());
app.use(
	cors({
		origin: process.env.APP_ORIGIN || false,
	}),
);
app.use(
	'/api/paystack/webhook',
	express.raw({ type: 'application/json', limit: '100kb' }),
	webhookRouter,
);
app.use(express.json({ limit: '10kb' }));

const plans = {
	monthly: { amount: 4000, currency: 'GHS' },
	yearly: { amount: 48000, currency: 'GHS' },
};

const initializeLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 10,
	standardHeaders: 'draft-8',
	legacyHeaders: false,
});

app.post('/api/payments/initialize', initializeLimiter, async (req, res) => {
	const {
		fullName,
		phone,
		email,
		plan = 'monthly',
		paymentMethod = 'Mobile Money',
	} = req.body;

	const trimmedName = typeof fullName === 'string' ? fullName.trim() : '';
	const trimmedPhone = typeof phone === 'string' ? phone.trim() : '';
	const trimmedEmail = typeof email === 'string' ? email.trim() : '';
	const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
	const validPhone = /^[+]?[0-9 ()-]{7,20}$/.test(trimmedPhone);

	if (
		trimmedName.length < 2 ||
		trimmedName.length > 100 ||
		!validPhone ||
		(trimmedEmail && !validEmail) ||
		!plans[plan] ||
		!['Mobile Money', 'Card'].includes(paymentMethod) ||
		!isFirebaseConfigured()
	) {
		return res.status(400).json({
			message: 'Invalid customer, plan, payment method, or backend configuration.',
		});
	}

	const selectedPlan = plans[plan];
	const customerEmail = trimmedEmail || `customer-${Date.now()}@markettracker.app`;

	try {
		const response = await axios.post(
			'https://api.paystack.co/transaction/initialize',
			{
				amount: selectedPlan.amount,
				currency: selectedPlan.currency,
				email: customerEmail,
				first_name: trimmedName.split(/\s+/)[0],
				metadata: {
					fullName: trimmedName,
					phone: trimmedPhone,
					plan,
					paymentMethod,
				},
			},
			{
				headers: {
					Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
					'Content-Type': 'application/json',
				},
				timeout: 15000,
			},
		);

		const transaction = response.data.data;
		await savePendingSubscription({
			reference: transaction.reference,
			fullName: trimmedName,
			phone: trimmedPhone,
			email: customerEmail,
			plan,
			amount: selectedPlan.amount,
			currency: selectedPlan.currency,
			paymentMethod,
		});

		return res.json({
			authorizationUrl: transaction.authorization_url,
			reference: transaction.reference,
		});
	} catch (error) {
		const message = error.response?.data?.message || 'Payment initialization failed.';
		console.error('Paystack initialization failed:', message);
		return res.status(502).json({ message });
	}
});

app.get('/health', (_req, res) => {
	res.json({ status: 'ok' });
});

app.listen(port, () => {
	console.log(`Payment backend listening on http://localhost:${port}`);
});
