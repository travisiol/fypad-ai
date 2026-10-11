/** Persona schema + validation, post validation, figure stripping (pure modules). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { INTRO_POSTS_SCHEMA, PERSONA_SCHEMA, REPLIES_SCHEMA, cleanHashtags, normalizeHandle, validHandle, validateIntroPosts, validatePersona, validatePost, validateReplies } from "../src/server/personas.ts";
import { compactUsd, sentenceIsClean, stripInventedFigures } from "../src/server/figures.ts";

test("persona schema is strict structured output: every property required, no extras", () => {
  for (const schema of [PERSONA_SCHEMA, INTRO_POSTS_SCHEMA, REPLIES_SCHEMA]) {
    const s = schema as { additionalProperties: boolean; required: string[]; properties: Record<string, unknown> };
    assert.equal(s.additionalProperties, false);
    assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
  }
  assert.deepEqual((PERSONA_SCHEMA as { required: string[] }).required, ["display_name", "handle", "bio", "personality", "voice", "posting_themes", "look"]);
});

test("validatePersona normalises the handle, clips the bio to 150 and refuses empty fields", () => {
  const p = validatePersona({
    display_name: "  Mika   Thrift ",
    handle: "@Mika Thrift!!",
    bio: `${"x".repeat(200)}`,
    personality: "Playful and sharp",
    voice: "lowercase, emoji",
    posting_themes: ["thrift hauls", "", "ootd", "x", "aa", "bb", "cc", "dd"],
    look: "pink bob, silver hoops",
  });
  assert.equal(p.displayName, "Mika Thrift");
  assert.equal(p.handle, "mika_thrift");
  assert.equal(p.bio.length, 150);
  assert.equal(p.themes.length, 5);
  assert.ok(!p.themes.includes(""));
  assert.throws(() => validatePersona({ display_name: "A", handle: "x", bio: "", personality: "", voice: "", posting_themes: [], look: "" }), /empty/);
  assert.throws(() => validatePersona({ display_name: "Ok Name", handle: "okname", bio: "hello there", personality: "kind", voice: "soft", posting_themes: [], look: "red hair" }), /themes/);
});

test("handles: Instagram rules, reserved routes refused", () => {
  assert.equal(normalizeHandle("..Hello.World__"), "hello.world");
  assert.equal(normalizeHandle("a"), "aai");
  assert.ok(validHandle("mika.thrift"));
  assert.ok(!validHandle("explore"));
  assert.ok(!validHandle("me"));
  assert.ok(!validHandle("ab"));
  assert.ok(!validHandle("bad-dash"));
  assert.deepEqual(cleanHashtags(["#Thrift", "thrift", "y2k style", "#", "ok"]), ["thrift", "y2kstyle", "ok"]);
});

test("posts: hashtags pulled out of the caption, three intro posts required, replies indexed", () => {
  const p = validatePost({ caption: "new haul #thrift today\nline two", hashtags: ["Thrift", "#OOTD"], scene: "shop" });
  assert.equal(p.caption, "new haul today\nline two");
  assert.deepEqual(p.hashtags, ["thrift", "ootd"]);
  assert.throws(() => validateIntroPosts({ posts: [{ caption: "a b", hashtags: [], scene: "abc" }] }), /fewer/);
  const r = validateReplies({ replies: [{ comment: 1, text: "thanks" }, { comment: 1, text: "dup" }, { comment: 9, text: "out of range" }, { comment: 2, text: "yes" }] }, 2);
  assert.deepEqual(r, [
    { index: 0, text: "thanks" },
    { index: 1, text: "yes" },
  ]);
});

test("figure stripping: only figures from the data survive, tickers stay", () => {
  const facts = { mcapUsd: 104_200, change24h: 12.34, milestoneUsd: 100_000 };
  assert.equal(compactUsd(104_200), "$104.2K");
  assert.equal(compactUsd(100_000), "$100K");
  assert.equal(compactUsd(2_500_000), "$2.5M");
  assert.ok(sentenceIsClean("we just passed $100K mcap!", facts));
  assert.ok(sentenceIsClean("$NOVA at $104.2K right now.", facts));
  assert.ok(sentenceIsClean("up 12.3% today", facts));
  assert.ok(!sentenceIsClean("next stop $1M.", facts));
  assert.ok(!sentenceIsClean("this will 100x", facts));
  assert.ok(!sentenceIsClean("up 50% this week", facts));
  const out = stripInventedFigures("gm fam ☀️ $NOVA just passed $100K!\nwe're going to $1M soon. this is a 10x play.\nlove you all 💖", facts);
  assert.equal(out, "gm fam ☀️ $NOVA just passed $100K!\nlove you all 💖");
  const none = stripInventedFigures("price target $5. up 20%. vibes only", { mcapUsd: null, change24h: null, milestoneUsd: null });
  assert.equal(none, "vibes only");
});
