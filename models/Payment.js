// models/Payment.js
const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema({
  merchantOrderId: { type: String, unique: true },
  uroPayOrderId: String,
  amount: Number,
  status: { type: String, default: "PENDING" },
  txnId: String,
  webhookPayload: Object
}, { timestamps: true });

module.exports = mongoose.model("Payment", paymentSchema);
