// src/routes/banking.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { BankAccount, BankTransaction } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');

// All banking routes are Super Admin only
router.use(authenticate, authorize('super_admin'));

// ─────────────────────────────────────────────────────────────
// ACCOUNTS
// ─────────────────────────────────────────────────────────────

// GET /api/banking/accounts — list active (non-deleted) accounts
router.get('/accounts', async (req, res) => {
    try {
        const accounts = await BankAccount.find({ deletedAt: null }).sort({ createdAt: -1 });
        res.json({ success: true, data: accounts });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/banking/accounts/:id — single account
router.get('/accounts/:id', async (req, res) => {
    try {
        const account = await BankAccount.findOne({ _id: req.params.id, deletedAt: null });
        if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
        res.json({ success: true, data: account });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/banking/accounts — create
router.post('/accounts', async (req, res) => {
    try {
        const { nickname, bankName, accountNumber, ifsc, currency, openingBalance, openingDate, notes } = req.body;
        if (!nickname || !bankName || !accountNumber) {
            return res.status(400).json({ success: false, message: 'nickname, bankName, accountNumber are required' });
        }
        const account = await BankAccount.create({
            nickname, bankName, accountNumber,
            ifsc: ifsc || '',
            currency: currency || 'INR',
            openingBalance: Number(openingBalance) || 0,
            balance: Number(openingBalance) || 0,
            openingDate: openingDate || new Date(),
            notes: notes || '',
            createdBy: req.user._id,
        });
        res.status(201).json({ success: true, data: account });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// PATCH /api/banking/accounts/:id — edit
router.patch('/accounts/:id', async (req, res) => {
    try {
        const allowed = ['nickname', 'bankName', 'accountNumber', 'ifsc', 'currency', 'balance', 'status', 'notes'];
        const update = {};
        for (const k of allowed) if (k in req.body) update[k] = req.body[k];
        const account = await BankAccount.findOneAndUpdate(
            { _id: req.params.id, deletedAt: null },
            update,
            { new: true }
        );
        if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
        res.json({ success: true, data: account });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// DELETE /api/banking/accounts/:id — soft delete (10s undo window)
router.delete('/accounts/:id', async (req, res) => {
    try {
        const account = await BankAccount.findByIdAndUpdate(
            req.params.id,
            { deletedAt: new Date() },
            { new: true }
        );
        if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
        res.json({ success: true, data: account });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/banking/accounts/:id/restore — undo delete within 10s
router.post('/accounts/:id/restore', async (req, res) => {
    try {
        const account = await BankAccount.findByIdAndUpdate(
            req.params.id,
            { deletedAt: null },
            { new: true }
        );
        if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
        res.json({ success: true, data: account });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─────────────────────────────────────────────────────────────
// TRANSACTIONS
// ─────────────────────────────────────────────────────────────

// GET /api/banking/accounts/:id/transactions — list for an account
router.get('/accounts/:id/transactions', async (req, res) => {
    try {
        const { from, to, category, limit = 200 } = req.query;
        const q = { account: req.params.id, deletedAt: null };
        if (from || to) {
            q.date = {};
            if (from) q.date.$gte = new Date(from);
            if (to) q.date.$lte = new Date(to);
        }
        if (category) q.category = category;
        const txns = await BankTransaction.find(q).sort({ date: -1, createdAt: -1 }).limit(Number(limit));
        res.json({ success: true, data: txns });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/banking/accounts/:id/transactions — add transaction
router.post('/accounts/:id/transactions', async (req, res) => {
    try {
        const { date, description, type, amount, category, reference, notes } = req.body;
        if (!description || !type || amount == null) {
            return res.status(400).json({ success: false, message: 'description, type, amount are required' });
        }
        if (!['credit', 'debit'].includes(type)) {
            return res.status(400).json({ success: false, message: 'type must be credit or debit' });
        }
        const account = await BankAccount.findOne({ _id: req.params.id, deletedAt: null });
        if (!account) return res.status(404).json({ success: false, message: 'Account not found' });

        const amt = Number(amount);
        const newBalance = type === 'credit' ? account.balance + amt : account.balance - amt;

        const txn = await BankTransaction.create({
            account: account._id,
            date: date || new Date(),
            description,
            type,
            amount: amt,
            category: category || 'Other',
            runningBalance: newBalance,
            reference: reference || '',
            notes: notes || '',
            createdBy: req.user._id,
        });

        account.balance = newBalance;
        await account.save();

        res.status(201).json({ success: true, data: txn, accountBalance: newBalance });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// DELETE /api/banking/transactions/:id — soft delete + reverse balance
router.delete('/transactions/:id', async (req, res) => {
    try {
        const txn = await BankTransaction.findOne({ _id: req.params.id, deletedAt: null });
        if (!txn) return res.status(404).json({ success: false, message: 'Transaction not found' });

        // Reverse the balance effect
        const account = await BankAccount.findById(txn.account);
        if (account) {
            account.balance = txn.type === 'credit'
                ? account.balance - txn.amount
                : account.balance + txn.amount;
            await account.save();
        }

        txn.deletedAt = new Date();
        await txn.save();

        res.json({ success: true, data: txn, accountBalance: account?.balance });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/banking/transactions/:id/restore — undo delete (re-apply balance)
router.post('/transactions/:id/restore', async (req, res) => {
    try {
        const txn = await BankTransaction.findById(req.params.id);
        if (!txn || !txn.deletedAt) return res.status(404).json({ success: false, message: 'Nothing to restore' });

        const account = await BankAccount.findById(txn.account);
        if (account) {
            account.balance = txn.type === 'credit'
                ? account.balance + txn.amount
                : account.balance - txn.amount;
            await account.save();
        }

        txn.deletedAt = null;
        await txn.save();

        res.json({ success: true, data: txn, accountBalance: account?.balance });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─────────────────────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────────────────────

// GET /api/banking/stats — total cash, monthly inflow/outflow/net
router.get('/stats', async (req, res) => {
    try {
        const accounts = await BankAccount.find({ deletedAt: null, status: 'active' });
        const totalCash = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

        const monthTxns = await BankTransaction.find({
            deletedAt: null,
            date: { $gte: startOfMonth, $lte: endOfMonth },
        });

        const inflow = monthTxns.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);
        const outflow = monthTxns.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0);

        res.json({
            success: true,
            data: {
                totalCash,
                inflow,
                outflow,
                net: inflow - outflow,
                accountsCount: accounts.length,
                transactionsThisMonth: monthTxns.length,
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;