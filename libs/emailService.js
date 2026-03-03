import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// Create a transporter using SMTP
// User will need to provide EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS in .env
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: process.env.EMAIL_PORT || 465,
  secure: true, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const sendOrderNotification = async (orderDetails) => {
  const { user, address, items, subtotal, total, paymentMethod, orderId } = orderDetails;

  const adminEmail = process.env.ADMIN_EMAIL || 'sanjayrathi575@gmail.com';
  
  // 1. Admin Email Content
  const adminMailOptions = {
    from: `"Kamlesh Suits" <${process.env.EMAIL_USER}>`,
    to: adminEmail,
    subject: `New Order Received - Order ID: ${orderId}`,
    html: `
      <div style="font-family: 'Georgia', serif; color: #1c1c1c; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px;">
        <h1 style="color: #c48c41; text-align: center; font-size: 24px;">New Order Notification</h1>
        <p style="text-align: center; color: #666;">You have received a new order on Kamlesh Suits.</p>
        
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 8px; margin-top: 20px;">
          <h2 style="font-size: 18px; border-bottom: 2px solid #c48c41; padding-bottom: 5px;">Customer Details</h2>
          <p><strong>Name:</strong> ${address.name}</p>
          <p><strong>Email:</strong> ${user.email}</p>
          <p><strong>Contact:</strong> +91 ${address.phone}</p>
        </div>

        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 8px; margin-top: 20px;">
          <h2 style="font-size: 18px; border-bottom: 2px solid #c48c41; padding-bottom: 5px;">Delivery Address</h2>
          <p>${address.houseNo}, ${address.area}<br>
             ${address.city}, ${address.state} - ${address.pincode}<br>
             ${address.landmark ? `Landmark: ${address.landmark}` : ''}</p>
        </div>

        <div style="margin-top: 20px;">
          <h2 style="font-size: 18px; border-bottom: 2px solid #c48c41; padding-bottom: 5px;">Order Summary</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background-color: #f0f0f0;">
                <th style="padding: 10px; text-align: left;">Product</th>
                <th style="padding: 10px; text-align: center;">Qty</th>
                <th style="padding: 10px; text-align: right;">Price</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(item => `
                <tr>
                  <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.title}</td>
                  <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
                  <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">₹${item.price}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div style="margin-top: 20px; text-align: right;">
          <p><strong>Subtotal:</strong> ₹${subtotal}</p>
          <p style="font-size: 18px; color: #c48c41;"><strong>Grand Total:</strong> ₹${total}</p>
          <p><strong>Payment Method:</strong> ${paymentMethod === 'cod' ? 'Cash on Delivery' : 'Digital Payment'}</p>
        </div>
      </div>
    `,
  };

  // 2. User Email Content
  const userMailOptions = {
    from: `"Kamlesh Suits" <${process.env.EMAIL_USER}>`,
    to: user.email,
    subject: `Order Confirmed - Thank you for shopping with Kamlesh Suits!`,
    html: `
      <div style="font-family: 'Helvetica', sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #c48c41; margin-bottom: 10px;">Order Confirmed!</h1>
          <p>Hi ${address.name}, your order <strong>#${orderId}</strong> has been successfully placed.</p>
        </div>

        <p>Thank you for choosing <strong>Kamlesh Suits</strong>. We are preparing your premium set for delivery!</p>
        
        <div style="background-color: #fef8f0; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Order Highlights:</h3>
          <ul style="list-style: none; padding: 0;">
            <li><strong>Total Amount:</strong> ₹${total}</li>
            <li><strong>Delivery To:</strong> ${address.city}, ${address.pincode}</li>
            <li><strong>Payment:</strong> ${paymentMethod === 'cod' ? 'Cash on Delivery' : 'Prepaid'}</li>
          </ul>
        </div>

        <p>We will notify you once your order is shipped. You can track your order status in your account dashboard.</p>
        
        <div style="text-align: center; margin-top: 40px; border-top: 1px solid #eee; pt: 20px;">
          <p style="color: #888; font-size: 12px;">Kamlesh Suits & Textiles • Premium Ethnic Wear</p>
        </div>
      </div>
    `,
  };

  try {
    // Send both emails
    await Promise.all([
      transporter.sendMail(adminMailOptions),
      transporter.sendMail(userMailOptions)
    ]);
    return { success: true };
  } catch (error) {
    console.error('Email sending failed:', error);
    return { success: false, error: error.message };
  }
};
