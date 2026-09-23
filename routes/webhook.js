const crypto = require('crypto');
const axios = require('axios');
const express = require('express');
const {
	getSubscription,
	savePaystackEvent,
	saveVerifiedSubscription,
} = require('../services/firebaseService');

const router = express.Router();

router.post('/', async (req, res) => {
	const signature = req.get('x-paystack-signature');
	const secret = process.env.PAYSTACK_SECRET_KEY;

	if (!signature || !secret || !Buffer.isBuffer(req.body)) {
		return res.sendStatus(400);
	}

	const expectedSignature = crypto
		.createHmac('sha512', secret)
		.update(req.body)
		.digest('hex');

	const receivedSignature = Buffer.from(signature, 'utf8');
	const expectedSignatureBuffer = Buffer.from(expectedSignature, 'utf8');

	if (
		receivedSignature.length !== expectedSignatureBuffer.length ||
		!crypto.timingSafeEqual(receivedSignature, expectedSignatureBuffer)
	) {
		return res.sendStatus(401);
	}

	let event;
	try {
		event = JSON.parse(req.body.toString('utf8'));
	} catch (_error) {
		return res.sendStatus(400);
	}

	try {
		if (event.event === 'charge.success') {
			const reference = event.data?.reference;
			if (!reference) return res.sendStatus(400);

			const verification = await axios.get(
				`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
				{
					headers: {
					Authorization: `Bearer ${secret}`,
				},
				timeout: 15000,
			},
			);

			const verifiedTransaction = verification.data?.data;
			if (
				verification.data?.status !== true ||
				verifiedTransaction?.status !== 'success' ||
				verifiedTransaction?.reference !== reference
			) {
				return res.sendStatus(400);
			}

			const metadata = verifiedTransaction.metadata || {};
			const expectedAmount = metadata.plan === 'yearly' ? 48000 : 4000;
			if (
				!['monthly', 'yearly'].includes(metadata.plan) ||
				verifiedTransaction.amount !== expectedAmount ||
				verifiedTransaction.currency !== 'GHS' ||
				!['Mobile Money', 'Card'].includes(metadata.paymentMethod) ||
				typeof metadata.phone !== 'string'
			) {
				return res.sendStatus(409);
			}

			const pendingSubscription = await getSubscription(reference);
			if (pendingSubscription) {
				if (
					pendingSubscription.amount !== verifiedTransaction.amount ||
					pendingSubscription.currency !== verifiedTransaction.currency ||
					pendingSubscription.plan !== metadata.plan ||
					pendingSubscription.paymentMethod !== metadata.paymentMethod ||
					pendingSubscription.phone !== metadata.phone
				) {
					return res.sendStatus(409);
				}
			} else {
				await saveVerifiedSubscription(verifiedTransaction);
			}

			event.data = verifiedTransaction;
		}

		await savePaystackEvent(event);
		console.log(`Paystack webhook saved to Firebase: ${event.event || 'unknown event'}`);
	} catch (error) {
		console.error('Could not save Paystack webhook to Firebase:', error.message);
		return res.sendStatus(500);
	}

	return res.sendStatus(200);
});

module.exports = router;
