const express = require("express");
const router = express.Router();
const uropayController = require("../controllers/uropayController");

// Existing routes
router.get("/", (req, res) => {
    res.render("userInput");
});

router.post("/payment", uropayController.createOrder);
router.get("/payment/success", uropayController.paymentSuccess);
router.get("/payment/cancel", uropayController.paymentCancel);

// 🔔 WEBHOOK ROUTE (POST ONLY)
router.post(
    "/payment/webhook/uropay",
    express.json({ type: "*/*" }), // webhook-safe
    uropayController.uropayWebhook
);
router.get("/payment/status", uropayController.checkPaymentStatus);


module.exports = router;
