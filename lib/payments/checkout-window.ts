export function openCheckoutWindow() {
  if (typeof window === "undefined") return null;

  const checkoutWindow = window.open("", "_blank");
  if (checkoutWindow) {
    checkoutWindow.document.write(`
      <!doctype html>
      <html>
        <head><title>Opening secure checkout</title></head>
        <body style="margin:0;font-family:Arial,sans-serif;background:#f8fafc;color:#0f172a;display:grid;min-height:100vh;place-items:center;">
          <main style="max-width:360px;padding:24px;text-align:center;">
            <h1 style="font-size:20px;margin:0 0 8px;">Opening secure checkout</h1>
            <p style="font-size:14px;line-height:1.5;margin:0;color:#475569;">Distributor OS is creating the Stripe payment session.</p>
          </main>
        </body>
      </html>
    `);
    checkoutWindow.document.close();
  }

  return checkoutWindow;
}

export function navigateCheckoutWindow(checkoutWindow: Window | null, url: string) {
  if (checkoutWindow && !checkoutWindow.closed) {
    checkoutWindow.opener = null;
    checkoutWindow.location.href = url;
    return;
  }

  window.location.href = url;
}

export function closeCheckoutWindow(checkoutWindow: Window | null) {
  if (checkoutWindow && !checkoutWindow.closed) checkoutWindow.close();
}

export function isStripeCheckoutUrl(url: string | null | undefined) {
  if (!url) return false;
  try {
    return new URL(url).hostname.endsWith("checkout.stripe.com");
  } catch {
    return false;
  }
}
