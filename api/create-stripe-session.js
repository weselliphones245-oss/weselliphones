const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { formData, paymentType = 'card' } = req.body;

    if (!formData || !formData.pricing || !formData.product) {
      return res.status(400).json({ error: 'Missing required form data' });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      console.error('STRIPE_SECRET_KEY is not configured');
      return res.status(500).json({ error: 'Payment system configuration error' });
    }

    const origin = req.headers.origin || req.headers.referer || 'https://weselliphones.com';
    const baseUrl = origin.replace(/\/$/, '');

    // Calculate per-item price (subtotal / quantity)
    const subtotal = formData.pricing.subtotal || (formData.product.basePrice * formData.product.quantity);
    const perItemPrice = Math.round((subtotal / formData.product.quantity) * 100);
    
    // Build line items array
    const line_items = [
      {
        price_data: {
          currency: formData.pricing.currency.toLowerCase(),
          product_data: {
            name: formData.product.name,
            description: formData.product.specs || '',
            images: formData.product.imageUrl ? [formData.product.imageUrl] : [],
          },
          unit_amount: perItemPrice,
        },
        quantity: formData.product.quantity || 1,
      }
    ];

    // Add shipping as a separate line item if there's a cost
    if (formData.pricing.shipping && formData.pricing.shipping > 0) {
      line_items.push({
        price_data: {
          currency: formData.pricing.currency.toLowerCase(),
          product_data: {
            name: formData.shipping?.method === 'express' ? 'Express Shipping (2-5 days)' : 'Standard Shipping',
            description: formData.shipping?.method === 'express' ? 'Fast delivery' : 'Standard delivery',
          },
          unit_amount: Math.round(formData.pricing.shipping * 100),
        },
        quantity: 1,
      });
    }

    // Add insurance as a line item if selected
    if (formData.pricing.insurance && formData.pricing.insurance > 0) {
      line_items.push({
        price_data: {
          currency: formData.pricing.currency.toLowerCase(),
          product_data: {
            name: 'Order Insurance',
            description: 'Protection for your order',
          },
          unit_amount: Math.round(formData.pricing.insurance * 100),
        },
        quantity: 1,
      });
    }

    // Prepare session configuration
    const sessionConfig = {
      mode: 'payment',
      line_items: line_items,
      customer_email: formData.customer?.email,
      metadata: {
        orderRef: formData.orderRef,
        customerName: `${formData.customer?.firstName} ${formData.customer?.lastName}`,
        phone: formData.customer?.phone,
        shippingMethod: formData.shipping?.method || 'standard',
        insurance: formData.pricing?.insurance ? 'yes' : 'no',
      },
      success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}&ref=${formData.orderRef}`,
      cancel_url: `${baseUrl}/payment.html`,
    };

    // Configure payment methods based on paymentType
    if (paymentType === 'ach') {
      // ACH Direct Debit
      if (formData.pricing.currency.toUpperCase() !== 'USD') {
        return res.status(400).json({ 
          error: 'ACH payments only support USD currency.' 
        });
      }
      sessionConfig.payment_method_types = ['us_bank_account'];
      sessionConfig.payment_method_options = {
        us_bank_account: {
          financial_connections: {
            permissions: ['payment_method', 'balances'],
          },
          verification_method: 'automatic',
        },
      };
    } else {
      // ✅ FIXED: Use explicit payment_method_types instead of automatic_payment_methods
      // This works with all Stripe API versions
      sessionConfig.payment_method_types = ['card'];
    }

    // Add shipping address collection
    sessionConfig.shipping_address_collection = {
      allowed_countries: ['US', 'CA', 'GB', 'AU', 'PL', 'FR', 'ES', 'DE', 'IT', 'NL', 'BE', 'AT', 'IE', 'PT'],
    };

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create(sessionConfig);

    return res.status(200).json({ 
      url: session.url,
      sessionId: session.id 
    });

  } catch (error) {
    console.error('Stripe error:', error);
    
    // Return detailed error info
    return res.status(400).json({ 
      error: error.message || 'Payment processing failed',
      type: error.type,
      param: error.param,
      details: error.raw?.message
    });
  }
};
