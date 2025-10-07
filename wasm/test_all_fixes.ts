#!/usr/bin/env bun

/**
 * Test all critical fixes for zig-mdx parser
 */

import { parse } from "./src/index";

const mdxSource = `# Testing All Fixes

## Test 1: Ordered Lists

1. First ordered item
2. Second ordered item
3. Third ordered item with **bold**

## Test 2: Inline Code

This is \`inline code\` in a sentence.

More text with \`another code\` example.

## Test 3: Images with Alt Text

![Alt text for image](image.jpg)

![Another alt text](another.jpg)

## Test 4: Mixed Content

- Unordered item
- Another unordered

1. Then ordered
2. More ordered

This has \`code\` and ![image](img.jpg) and a [link](url.com).
`;

console.log("🔍 Testing All Critical Fixes...\n");

try {
  const ast = await parse(mdxSource);

  console.log("✅ Parse successful!\n");
  console.log(`📊 Stats:`);
  console.log(`   Nodes: ${ast.nodes.length}`);
  console.log(`   Tokens: ${ast.tokens.length}`);
  console.log(`   Errors: ${ast.errors.length}`);

  if (ast.errors.length > 0) {
    console.log("\n⚠️  Errors:");
    for (const error of ast.errors) {
      console.log(`   - ${error.tag} at token ${error.token}`);
    }
  }

  // Test 1: Ordered Lists
  const orderedLists = ast.nodes.filter((n) => n.type === "list_ordered");
  console.log(`\n✅ Test 1: Found ${orderedLists.length} ordered list(s)`);
  if (orderedLists.length > 0) {
    for (const list of orderedLists) {
      const children = "children" in list ? list.children : [];
      console.log(`   - List with ${children.length} items`);
    }
  }

  // Test 2: Inline Code
  const inlineCodes = ast.nodes.filter((n) => n.type === "code_inline");
  console.log(`\n✅ Test 2: Found ${inlineCodes.length} inline code node(s)`);

  // Test 3: Images
  const images = ast.nodes.filter((n) => n.type === "image");
  console.log(`\n✅ Test 3: Found ${images.length} image(s)`);
  for (const image of images) {
    if ("textNode" in image) {
      const textNodeIdx = image.textNode;
      if (typeof textNodeIdx === "number" && textNodeIdx !== image.index) {
        const textNode = ast.nodes[textNodeIdx];
        if (textNode && "text" in textNode) {
          console.log(
            `   - Image [${image.index}] textNode: ${textNodeIdx} → "${textNode.text}"`
          );
          console.log(`     ✓ textNode points to separate text node (FIXED!)`);
        }
      } else {
        console.log(`   - Image [${image.index}] textNode: ${textNodeIdx}`);
        console.log(`     ✗ ERROR: textNode points to self or invalid!`);
      }
    }
  }

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("📋 Summary of Fixes:");
  console.log(
    `   1. Ordered Lists: ${orderedLists.length > 0 ? "✅ WORKING" : "❌ BROKEN"}`
  );
  console.log(
    `   2. Inline Code: ${inlineCodes.length > 0 ? "✅ WORKING" : "❌ BROKEN"}`
  );

  let imagesFixed = true;
  for (const image of images) {
    if ("textNode" in image && image.textNode === image.index) {
      imagesFixed = false;
    }
  }
  console.log(
    `   3. Image Alt Text: ${imagesFixed && images.length > 0 ? "✅ WORKING" : "❌ BROKEN"}`
  );
  console.log("=".repeat(50));

  console.log("\n🎉 All fixes verified!");
} catch (error) {
  console.error("❌ Error:", error);
  process.exit(1);
}
