const express = require("express");
const Route = express.Router();
const uropayController = require('../controllers/uropayController');


Route.get("/", (req, res) => {
    res.render("userInput");
})

Route.post("/payment", uropayController.createOrder);
Route.get("/payment/success", uropayController.paymentSuccess);
Route.get("/payment/cancel", uropayController.paymentCancel);

module.exports = Route;
