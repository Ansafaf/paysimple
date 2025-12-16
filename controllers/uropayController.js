const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const Payment = require("../models/Payment");

/* ================================
   CREATE ORDER
================================ */
exports.createOrder = async (req, res) => {
  try {
    const { name, email } = req.body;
    const amount = parseFloat(req.body.amount);

    if (!amount || !name) {
      return res.status(400).send("Name and Amount are required");
    }

    const apiKey = process.env.URO_API_KEY;
    const secretKey = process.env.UROPAY_SECRET_KEY;
    const merchantVpa = process.env.OWNER_UPI;

    if (!apiKey || !secretKey || !merchantVpa) {
      return res.status(500).send("Missing Uropay configuration");
    }

    // Hash secret (as per Uropay)
    const hashedSecret = crypto
      .createHash("sha512")
      .update(secretKey)
      .digest("hex");

    const orderId = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const amountInPaise = Math.round(amount * 100);

    // 🔴 VERY IMPORTANT: create DB record BEFORE payment
    await Payment.create({
      merchantOrderId: orderId,
      amount,
      status: "PENDING"
    });

    const payload = {
      vpa: merchantVpa,
      vpaName: "SimplePay Merchant",
      amount: amountInPaise,
      merchantOrderId: orderId,
      transactionNote: `Payment for ${orderId}`,
      customerName: name,
      customerEmail: email || "customer@example.com",
      notes: { custom_id: uuidv4() }
    };

    const response = await fetch("https://api.uropay.me/order/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-API-KEY": apiKey,
        "Authorization": `Bearer ${hashedSecret}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (data.status !== "success") {
      return res.status(500).send("Failed to create payment");
    }

    const { upiString, qrCode } = data.data;
    const formattedAmount = amount.toFixed(2);

    const urlObj = new URL(upiString.replace("upi://", "https://"));
    const pa = urlObj.searchParams.get("pa");
    const pn = urlObj.searchParams.get("pn") || "Merchant";
    const tn = urlObj.searchParams.get("tn") || "Payment";

    const finalUpiLink =
      `upi://pay?pa=${pa}&pn=${encodeURIComponent(pn)}` +
      `&am=${formattedAmount}&cu=INR&tn=${encodeURIComponent(tn)}`;

    return res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Complete Payment</title>
</head>
<body style="text-align:center;font-family:sans-serif">
  <h2>Pay ₹${amount}</h2>
  <img src="${qrCode}" width="250"/>
  <p>Order ID: ${orderId}</p>
  <a href="${finalUpiLink}">Pay with UPI App</a>

  <p>Waiting for payment...</p>

  <script>
    const orderId = "${orderId}";
    const poll = setInterval(async () => {
      const res = await fetch("/payment/status?orderId=" + orderId);
      const data = await res.json();

      if (data.status === "SUCCESS") {
        clearInterval(poll);
        window.location.href = "/payment/success?orderId=" + orderId;
      }

      if (data.status === "FAILED") {
        clearInterval(poll);
        window.location.href = "/payment/cancel?orderId=" + orderId;
      }
    }, 3000);
  </script>
</body>
</html>
    `);

  } catch (err) {
    console.error(err);
    res.status(500).send("Internal Server Error");
  }
};

/* ================================
   WEBHOOK (SAFE + IDEMPOTENT)
================================ */
exports.uropayWebhook = async (req, res) => {
  try {
    const { merchantOrderId, status, txnId, uroPayOrderId } = req.body;

    const payment = await Payment.findOne({ merchantOrderId });

    // Always ACK webhook
    if (!payment) return res.status(200).json({ success: true });

    // 🔒 Never overwrite SUCCESS
    if (payment.status === "SUCCESS") {
      return res.status(200).json({ success: true });
    }

    const allowed = ["SUCCESS", "FAILED", "PENDING"];
    if (!allowed.includes(status)) {
      return res.status(200).json({ success: true });
    }

    payment.status = status;
    payment.txnId = txnId;
    payment.uroPayOrderId = uroPayOrderId;
    payment.webhookPayload = req.body;

    await payment.save();

    res.status(200).json({ success: true });

  } catch (err) {
    console.error("Webhook error:", err);
    res.status(200).json({ success: true });
  }
};

/* ================================
   CHECK PAYMENT STATUS (POLLING)
================================ */
exports.checkPaymentStatus = async (req, res) => {
  const { orderId } = req.query;

  const payment = await Payment.findOne({ merchantOrderId: orderId });

  if (!payment) {
    return res.json({ status: "PENDING" });
  }

  res.json({ status: payment.status });
};

/* ================================
   SUCCESS / CANCEL PAGES
================================ */
exports.paymentSuccess = (req, res) => {
  res.send(`
    <h1 style="color:green">Payment Successful</h1>
    <p>Order ID: ${req.query.orderId}</p>
    <a href="/">Home</a>
  `);
};

exports.paymentCancel = (req, res) => {
  res.send(`
    <h1 style="color:red">Payment Failed</h1>
    <p>Order ID: ${req.query.orderId}</p>
    <a href="/">Try Again</a>
  `);
};
