/* =========================================================================
   One-time setup: pulls the Supabase library and the site's Google Fonts
   down into local files instead of loading them from the internet on every
   single page open.

   WHY: every page currently has a <script> tag pointing at
   cdn.jsdelivr.net and a <link> tag pointing at fonts.googleapis.com. Even
   though the HTML/CSS/JS you wrote live inside the app already, those two
   pieces are still fetched live over the network every time a page loads —
   that's real, felt delay, it's extra data used, and it's exactly what
   caused the "Couldn't load the Supabase library" error a few weeks back.
   Running this once downloads both into this project so every page reads
   them from disk instead, same as everything else already does.

   HOW TO RUN THIS:
   1. Open Terminal.
   2. cd into this project folder (the one this file is sitting in) —
      e.g. cd ~/Documents/GitHub/ensemble-fitness-app
   3. node fetch-local-assets.js
   4. When it says "All done", run it again from inside
      ~/Desktop/ensemble-fitness-mobile/www (the mobile app needs its own
      copy of these same files) — or just copy the three things it created
      (js/vendor, assets/fonts, css/fonts.css) into that folder instead of
      running it twice. Either way works.
   5. Commit everything as usual (GitHub Desktop for the website, npm run
      sync + rebuild in Xcode/Android Studio for the mobile app).

   Safe to run more than once — it just re-downloads and overwrites the
   same files.
   ========================================================================= */
const https = require("https");
const fs = require("fs");
const path = require("path");

function get(url, headers) {
  return new Promise(function (resolve, reject) {
    https.get(url, { headers: headers || {} }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(get(res.headers.location, headers));
      }
      if (res.statusCode !== 200) {
        return reject(new Error("HTTP " + res.statusCode + " for " + url));
      }
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () { resolve(Buffer.concat(chunks)); });
    }).on("error", reject);
  });
}

async function main() {
  console.log("Downloading Supabase JS library...");
  fs.mkdirSync("js/vendor", { recursive: true });
  var supabaseJs = await get("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js");
  fs.writeFileSync("js/vendor/supabase.js", supabaseJs);
  console.log("Saved js/vendor/supabase.js (" + supabaseJs.length + " bytes)");

  console.log("Downloading fonts (Inter, Poppins, Caveat, Dancing Script)...");
  fs.mkdirSync("assets/fonts", { recursive: true });
  // The union of every weight any page in this app actually uses — one
  // shared local stylesheet covers every page instead of needing a
  // different bundle per page.
  var fontsCssUrl = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@700;800;900&family=Caveat:wght@600;700&family=Dancing+Script:wght@600;700&display=swap";
  var cssBuf = await get(fontsCssUrl, {
    // Google serves different font file formats depending on the
    // requesting browser — a plain curl-style request gets old-style
    // fonts. Asking with a normal desktop-Chrome User-Agent gets the
    // modern, much smaller .woff2 files, same as what the app actually
    // renders with today.
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
  });
  var css = cssBuf.toString("utf8");

  var urls = Array.from(new Set((css.match(/https:\/\/fonts\.gstatic\.com\/[^)]+/g) || [])));
  var i = 0;
  for (var u = 0; u < urls.length; u++) {
    var url = urls[u];
    var ext = url.split(".").pop();
    var localName = "font-" + (i++) + "." + ext;
    var buf = await get(url);
    fs.writeFileSync(path.join("assets/fonts", localName), buf);
    css = css.split(url).join("../assets/fonts/" + localName);
    console.log("Saved assets/fonts/" + localName);
  }

  fs.mkdirSync("css", { recursive: true });
  fs.writeFileSync("css/fonts.css", css);
  console.log("Wrote css/fonts.css");
  console.log("\nAll done. See the top of this file for the next step.");
}

main().catch(function (err) {
  console.error("Failed:", err.message);
  process.exit(1);
});
