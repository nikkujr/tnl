import { test } from "node:test";
import assert from "node:assert/strict";
import { renderWorkflowEmail } from "../src/shared/email-template.js";
const origin = "https://tnl.example.test";

test("plain automation templates become branded HTML while keeping readable text", () => {
  const email = renderWorkflowEmail(
    {
      config: {
        subject: "Order {{trackingNumber}} update",
        template:
          "Hello {{customerName}}.\n\nYour order is {{status}}.\nWe will keep you updated.",
      },
      vars: {
        customerName: "Maria & Sons <img src=x onerror=alert(1)>",
        trackingNumber: "TNL-1042",
        status: "IN_TRANSIT",
      },
    },
    "ORDER_UPDATES",
    origin,
  );
  assert.equal(email.subject, "Order TNL-1042 update");
  assert.match(email.html, /TNL TRACK/);
  assert.match(email.html, /bgcolor="#302d4f"/);
  assert.match(email.html, /bgcolor="#7167c9"/);
  assert.match(email.html, /Maria &amp; Sons &lt;img/);
  assert(!email.html.includes("<img"));
  assert.match(email.html, /In transit/);
  assert.match(email.html, /<br>We will keep you updated/);
  assert.match(email.html, /href="https:\/\/tnl.example.test\/portal"/);
  assert.match(email.text, /Your order is In transit/);
  assert.match(
    email.text,
    /Open customer portal: https:\/\/tnl.example.test\/portal/,
  );
  assert(!email.text.includes("<table"));
  assert(!email.html.includes("Unsubscribe"));
});

test("activation/reset buttons preserve token, expiry, and legacy queued account links", () => {
  for (const mode of ["verify", "reset"]) {
    const url = `${origin}/portal?${mode}=abc123`;
    const email = renderWorkflowEmail(
      {
        subject:
          mode === "reset" ? "Reset your password" : "Activate your account",
        text: `Open ${url}\nThis link expires in 30 minutes. If you did not request it, ignore this email.`,
      },
      "ACCOUNT_EMAIL",
      origin,
    );
    assert.match(email.html, /This link expires in 30 minutes/);
    assert.match(email.html, /If you did not request it/);
    assert(email.html.includes(`href="${url}"`));
    assert(
      email.html.includes(
        mode === "reset" ? "Reset password" : "Activate account",
      ),
    );
    assert(email.text.includes(url));
    assert(!email.html.includes(`Open ${url}`));
  }
});

test("marketing campaigns keep authored content inside the brand and include unsubscribe once", () => {
  const email = renderWorkflowEmail(
    {
      subject: "New offers",
      content:
        "<h2>Our new packages</h2><p><strong>Save today</strong></p><script>alert(1)</script><style>body{display:none}</style>",
      unsubscribe: `${origin}/portal?unsubscribe=token&source=email`,
    },
    "CAMPAIGN_SEND",
    origin,
  );
  assert.match(email.html, /<h2>Our new packages<\/h2>/);
  assert.match(email.html, /<strong>Save today<\/strong>/);
  assert(!email.html.includes("alert(1)"));
  assert(!email.html.includes("display:none}"));
  assert.equal((email.html.match(/>Unsubscribe</g) ?? []).length, 1);
  assert.match(email.html, /unsubscribe=token&amp;source=email/);
  assert.match(email.text, /Our new packages\nSave today/);
  assert.match(email.text, /Unsubscribe: https:/);
});

test("invalid action URLs never become button links and plain messages remain escaped", () => {
  const email = renderWorkflowEmail(
    {
      subject: "<script>Bad title</script>",
      text: "<b>Literal message</b>",
      actionUrl: "javascript:alert(1)",
      unsubscribe: "data:text/html,test",
    },
    "FOLLOWUP_REPLY",
    origin,
  );
  assert(!email.html.includes('href="javascript:'));
  assert(!email.html.includes('href="data:'));
  assert.match(email.html, /&lt;b&gt;Literal message&lt;\/b&gt;/);
  assert.match(email.html, /&lt;script&gt;Bad title/);
});
