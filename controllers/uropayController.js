const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

exports.createOrder = async (req, res) => {
    try {
        const { name, email, phone } = req.body;
        const amount = parseFloat(req.body.amount);

        if (!amount || !name) {
            return res.status(400).send("Name and Amount are required");
        }

        const apiKey = process.env.URO_API_KEY;
        const secretKey = process.env.UROPAY_SECRET_KEY;
        const merchantVpa = process.env.OWNER_UPI; // From .env

        if (!apiKey || !secretKey || !merchantVpa) {
            return res.status(500).send("Configuration Error: Missing API Key, Secret, or VPA in .env");
        }

        // Hashing Secret as per Uropay Documentation
        const sha512 = crypto.createHash('sha512');
        sha512.update(secretKey);
        const hashedSecret = sha512.digest('hex');

        const orderId = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        const payload = {
            vpa: merchantVpa,
            vpaName: "SimplePay Merchant",
            amount: amount,
            merchantOrderId: orderId,
            transactionNote: `Payment for ${orderId}`,
            customerName: name,
            customerEmail: email || "customer@example.com",
            notes: {
                custom_id: uuidv4()
            }
        };

        const uropayEndpoint = "https://api.uropay.me/order/generate";

        console.log("-------------------------------------------------");
        console.log("🚀 Initiating Payment with Uropay");
        console.log("Endpoint:", uropayEndpoint);
        console.log("Payload:", JSON.stringify(payload, null, 2));
        console.log("-------------------------------------------------");

        try {
            const response = await fetch(uropayEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-API-KEY': apiKey,
                    'Authorization': `Bearer ${hashedSecret}`
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            console.log("✅ Uropay Response:", data);

            if (data.status === 'success' && data.data) {
                const { upiString, qrCode, uroPayOrderId } = data.data;

                // FIX: Ensure UPI String is compatible with GPay and other apps
                // "Limit Exceeded" errors often occur when 'mc' (Merchant Code) is present for personal/unverified VPAs.
                // We will reconstruct the link to be a clean P2P transfer request.
                let finalUpiLink = upiString;
                try {
                    const formattedAmount = parseFloat(amount).toFixed(2);

                    // URL parsing hack: Replace protocol to https to use standard URL API
                    const urlObj = new URL(finalUpiLink.replace('upi://', 'https://'));

                    const pa = urlObj.searchParams.get('pa');
                    const pn = urlObj.searchParams.get('pn') || "Merchant";
                    const tn = urlObj.searchParams.get('tn') || "Payment";

                    // Reconstruct clean link:
                    // - pa: Payee Address (VPA)
                    // - pn: Payee Name
                    // - am: Amount
                    // - cu: Currency
                    // - tn: Note
                    // REMOVED: mc (Merchant Code), tr (Transaction Ref), &url, &sign, etc. to avoid strict merchant checks.
                    finalUpiLink = `upi://pay?pa=${pa}&pn=${encodeURIComponent(pn)}&am=${formattedAmount}&cu=INR&tn=${encodeURIComponent(tn)}`;

                    console.log("Original UPI:", upiString);
                    console.log("Optimized UPI for GPay:", finalUpiLink);

                } catch (err) {
                    console.error("Error fixing UPI string:", err);
                    // Fallback: just ensure amount is correct if parsing failed
                    const formattedAmount = parseFloat(amount).toFixed(2);
                    if (finalUpiLink.includes('&am=')) {
                        finalUpiLink = finalUpiLink.replace(/&am=[^&]* /, `&am=${formattedAmount}`);
                    } else {
                        finalUpiLink += `&am=${formattedAmount}`;
                    }
                    if (!finalUpiLink.includes('&cu=')) {
                        finalUpiLink += `&cu=INR`;
                    }
                }

                // Render Payment Page
                return res.send(`
                    <!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Complete Payment</title>
                        <style>
                            body { font-family: 'Segoe UI', sans-serif; text-align: center; padding: 20px; background: #f4f7f6; }
                            .card { background: white; max-width: 400px; margin: 0 auto; padding: 30px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); }
                            .btn { display: block; width: 100%; padding: 15px; margin: 10px 0; background: #667eea; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; transition: 0.2s; border: none; cursor: pointer; }
                            .btn:hover { background: #5a6fd6; }
                            .qr-container { margin: 20px 0; }
                            .qr-container img { max-width: 100%; border-radius: 8px; border: 1px solid #eee; }
                            .amount { font-size: 24px; color: #333; font-weight: bold; margin-bottom: 20px; }
                            .timer { color: #666; font-size: 14px; margin-top: 15px; }
                        </style>
                    </head>
                    <body>
                        <div class="card">
                            <h2>Scan or Pay via App</h2>
                            <div class="amount">₹${amount}</div>
                            
                            <!-- QR Code Section -->
                            <div class="qr-container">
                                <img src="${qrCode}" alt="Payment QR Code">
                            </div>
                            
                            <p>Order ID: ${uroPayOrderId}</p>

                            <!-- UPI Intent Buttons -->
                            <a href="${finalUpiLink}" class="btn">Pay with UPI App</a>
                            
                            <div class="timer">
                                <p>After payment, please <a href="/">Return Home</a></p>
                            </div>
                        </div>

                        <!-- Auto-redirect on mobile attempt -->
                        <script>
                            // Detect mobile and try to auto-open if requested
                             if (/Android|iPhone/i.test(navigator.userAgent)) {
                                 // Optional: Auto redirect
                                 // window.location.href = "${upiString}";
                             }
                        </script>
                    </body>
                    </html>
                `);

            } else {
                console.error("❌ API Error:", data);
                // Fallback for Debugging
                if (process.env.NODE_ENV !== 'production') {
                    return res.status(500).send(`
                   <h2>Payment Creation Failed</h2>
                   <p>API Message: ${data.message}</p>
                   <p>Endpoint: ${uropayEndpoint}</p>
                   <pre>${JSON.stringify(data, null, 2)}</pre>
                   `);
                }
                return res.status(500).send(`Payment Creation Failed: ${data.message || 'Unknown Error'}`);
            }

        } catch (fetchError) {
            console.error("Fetch Error:", fetchError);
            return res.status(500).send(`Connection Error: ${fetchError.message}`);
        }

    } catch (error) {
        console.error("Controller Critical Error:", error);
        res.status(500).send("Internal Server Error: " + error.message);
    }
};

exports.paymentSuccess = (req, res) => {
    res.send(`
        <div style="text-align: center; margin-top: 50px; font-family: sans-serif;">
            <h1 style="color: #2ecc71;">Payment Successful!</h1>
            <p>Your payment has been processed successfully.</p>
            <p>Order ID: ${req.query.client_txn_id || 'N/A'}</p>
            <a href='/' style="display: inline-block; margin-top: 20px; text-decoration: none; color: #3498db;">Return Home</a>
        </div>
    `);
};

exports.paymentCancel = (req, res) => {
    res.send(`
        <div style="text-align: center; margin-top: 50px; font-family: sans-serif;">
            <h1 style="color: #e74c3c;">Payment Cancelled</h1>
            <p>You cancelled the payment process.</p>
            <a href='/' style="display: inline-block; margin-top: 20px; text-decoration: none; color: #3498db;">Try Again</a>
        </div>
    `);
};
