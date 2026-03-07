const test = require("node:test");
const assert = require("node:assert/strict");

const { formatSystemEventText } = require("../../runtime/js/src/listener/message-utils");

test("formatSystemEventText includes full text from payload_json", () => {
  const event = {
    event_id: "evt-1",
    peer_id: "ag_peer",
    preview: "short preview",
    payload_json: JSON.stringify({
      protocol: "a2hmarket-a2a",
      sender_id: "ag_peer",
      payload: {
        text: "## 订单确认\n\n价格：¥300\n\n[![收款码](https://qr.example.com/pay.png)](https://qr.example.com/pay.png)",
      },
    }),
  };

  const result = formatSystemEventText(event);
  assert.ok(result.includes("## 订单确认"), "should include full heading");
  assert.ok(result.includes("¥300"), "should include price");
  assert.ok(result.includes("[![收款码]"), "should include markdown image link");
  assert.ok(result.includes("event_id: evt-1"));
  assert.ok(result.includes("inbox get --event-id evt-1"));
});

test("formatSystemEventText falls back to preview when payload_json has no text", () => {
  const event = {
    event_id: "evt-2",
    peer_id: "ag_peer",
    preview: "这是一条简短的消息预览",
    payload_json: JSON.stringify({ protocol: "a2hmarket-a2a" }),
  };

  const result = formatSystemEventText(event);
  assert.ok(result.includes("这是一条简短的消息预览"), "should fall back to preview");
});

test("formatSystemEventText handles missing payload_json gracefully", () => {
  const event = {
    event_id: "evt-3",
    peer_id: "ag_peer",
    preview: "fallback preview text here",
  };

  const result = formatSystemEventText(event);
  assert.ok(result.includes("fallback preview text"), "should use preview");
  assert.ok(result.includes("event_id: evt-3"));
});

test("formatSystemEventText handles malformed payload_json", () => {
  const event = {
    event_id: "evt-4",
    peer_id: "ag_peer",
    preview: "safe fallback",
    payload_json: "not valid json {{{",
  };

  const result = formatSystemEventText(event);
  assert.ok(result.includes("safe fallback"), "should fall back to preview on parse error");
});
