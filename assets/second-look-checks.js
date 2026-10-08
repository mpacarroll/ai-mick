/* Second Look's red-flag checks, shared by the full tool (tools/second-look/)
   and the working copy in the hub's hero, so the two can never disagree.
   Runs entirely in the browser; nothing is sent anywhere. */
(function (root) {
  function check(message, ask) {
    var flags = [];
    var lower = (message || "").toLowerCase();
    if (/urgent|immediately|within \d+ hours?|act now|expires? (today|soon)|final notice/.test(lower)) {
      flags.push("Uses urgency or a countdown to stop you from thinking it through. That pressure is the tactic, not a real deadline.");
    }
    if (/gift card|itunes|google play card|wire transfer|western union|crypto|bitcoin/.test(lower)) {
      flags.push("Asks for payment in a form no legitimate organization uses (gift cards, wire transfer, or crypto). This alone is close to a guarantee.");
    }
    if (/verify your (account|identity)|confirm your (details|password|account)|click here|log ?in to (confirm|verify)/.test(lower)) {
      flags.push("Asks you to click a link and log in to \"verify\" something. Go to the real site or app yourself instead of clicking through.");
    }
    if (/one.time code|verification code|sent to your phone|read (me|us) the code/.test(lower)) {
      flags.push("Asks for a one-time code. No legitimate company or agency ever needs you to read one back to them.");
    }
    if (/suspended|locked|unusual activity|unauthorized/.test(lower)) {
      flags.push("Claims your account is suspended or under threat. Check the real account directly (typed URL or official app), not through this message.");
    }
    if (/won|winner|prize|refund|inheritance/.test(lower)) {
      flags.push("Involves money you did not expect (a prize, refund, or windfall). Unexpected money almost always means the ask comes after, not before.");
    }
    if (ask === "Send money or a gift card") {
      flags.push("You said this is asking for money or a gift card directly. Stop before sending anything and verify through a channel you looked up yourself, not one the message gave you.");
    }
    if (ask === "Share a code sent to my phone") {
      flags.push("You said it wants a code from your phone. Do not share it. This is one of the most reliable scam signals there is.");
    }
    if (flags.length === 0) {
      flags.push("No obvious red-flag phrases were detected in the text. That does not mean it is safe, only that it did not match the common patterns. Still verify independently before acting, especially if money, a code, or a login is involved.");
    }
    return flags;
  }
  root.SecondLook = { check: check };
})(window);
