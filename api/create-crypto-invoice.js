module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { formData } = req.body;

    // Validate required data
    if (!formData || !formData.pricing || !formData.product || !formData.customer) {
      return res.status(400).json({ error: 'Missing required form data' });
    }

    // Validate NOWPayments API key exists
    if (!process.env.NOWPAYMENTS_API_KEY) {
      console.error('NOWPAYMENTS_API_KEY is not configured');
      return res.status(500).json({ error: 'Payment system configuration error' });
    }

    // Get the origin for callback URLs
    const origin = req.headers.origin || req.headers.referer || 'https://weselliphones.com';
    const baseUrl = origin.replace(/\/$/, ''); // Remove trailing slash if present

    // Prepare the invoice data for NOWPayments API
    const invoiceData = {
      price_amount: formData.pricing.total,
      price_currency: formData.pricing.currency.toLowerCase(),
      order_id: formData.orderRef,
      order_description: `${formData.product.name} ${formData.product.specs ? '- ' + formData.product.specs : ''}`.trim(),
      ipn_callback_url: `${baseUrl}/api/crypto-webhook`,
      success_url: `${baseUrl}/success.html?ref=${formData.orderRef}`,
      cancel_url: `${baseUrl}/payment.html`,
      // Additional metadata for better tracking
      is_fixed_rate: true, // Lock the crypto amount at invoice creation
      is_fee_paid_by_user: false, // Merchant pays the fee
    };

    console.log('Creating NOWPayments invoice:', {
      order_id: invoiceData.order_id,
      amount: invoiceData.price_amount,
      currency: invoiceData.price_currency
    });

    // Create invoice with NOWPayments
    const response = await fetch('https://api.nowpayments.io/v1/invoice', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.NOWPAYMENTS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(invoiceData),
    });

    // Parse response
    const responseText = await response.text();
    let data;
    
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse NOWPayments response:', responseText);
      return res.status(500).json({ 
        error: 'Invalid response from payment processor' 
      });
    }

    // Check if the request was successful
    if (!response.ok) {
      console.error('NOWPayments API error:', {
        status: response.status,
        statusText: response.statusText,
        error: data
      });

      // Handle specific error cases
      if (response.status === 401) {
        return res.status(500).json({ 
          error: 'Payment system authentication failed. Please contact support.' 
        });
      }

      if (response.status === 400) {
        return res.status(400).json({ 
          error: 'Invalid payment details. Please check your information.',
          details: data.message || 'Invalid request parameters'
        });
      }

      return res.status(response.status).json({ 
        error: 'Failed to create crypto payment',
        details: data.message || 'Please try again or contact support'
      });
    }

    // Validate response data
    if (!data.invoice_url) {
      console.error('Invalid NOWPayments response - missing invoice_url:', data);
      return res.status(500).json({ error: 'Invalid payment response received' });
    }

    console.log('NOWPayments invoice created successfully:', {
      invoice_id: data.id,
      order_id: data.order_id,
      invoice_url: data.invoice_url
    });

    // Return the invoice URL and details
    return res.status(200).json({ 
      invoice_url: data.invoice_url,
      invoice_id: data.id,
      order_id: data.order_id,
      created_at: data.created_at,
      // Return payment address if available for QR code generation
      pay_address: data.pay_address,
      pay_amount: data.pay_amount,
      pay_currency: data.pay_currency
    });

  } catch (error) {
    console.error('Crypto payment error:', error);
    
    // Handle network errors
    if (error.name === 'FetchError' || error.code === 'ENOTFOUND') {
      return res.status(503).json({ 
        error: 'Payment service temporarily unavailable. Please try again.' 
      });
    }

    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
      return res.status(503).json({ 
        error: 'Connection timeout. Please check your internet connection and try again.' 
      });
    }

    return res.status(500).json({ 
      error: 'Failed to process crypto payment. Please try again.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
