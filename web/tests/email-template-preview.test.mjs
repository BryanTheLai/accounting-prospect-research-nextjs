import assert from "node:assert/strict";
import { test } from "node:test";
import { EmailTemplatePreviewError, renderEmailTemplatePreview } from "../lib/email-template-preview.mjs";

test("preview substitutes the selected contact's buyer and company values", () => {
  assert.equal(
    renderEmailTemplatePreview("Hey {{buyer_name}}, books for {{company_name}}?", {
      buyer_name: "Casey Founder",
      company_name: "Northstar AI",
    }),
    "Hey Casey Founder, books for Northstar AI?",
  );
});

test("preview uses the dispatcher's safe greeting when the buyer name is empty", () => {
  assert.equal(renderEmailTemplatePreview("Hey {{buyer_name}}", { buyer_name: "  " }), "Hey there");
});

test("preview resolves nested spintax using the provided choice source", () => {
  const choices = [0.99, 0];
  assert.equal(renderEmailTemplatePreview("{Hi|{Hello|Hey}} {{buyer_name}}", { buyer_name: "Casey" }, () => choices.shift()), "Hi Casey");
  assert.equal(renderEmailTemplatePreview("{Hi|{Hello|Hey}} {{buyer_name}}", { buyer_name: "Casey" }, () => 0.99), "Hey Casey");
});

test("preview rejects malformed spintax without sending or saving anything", () => {
  assert.throws(() => renderEmailTemplatePreview("Hello {Hi|Hey", {}), EmailTemplatePreviewError);
});
