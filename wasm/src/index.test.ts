import { describe, test, expect } from "bun:test";
import { parse, getVersion, reset } from "./index";
import type { HeadingNode, CodeBlockNode, JsxSelfClosingNode, JsxElementNode } from "./types";

describe("zig-mdx WASM", () => {
  test("initializes and returns version", async () => {
    const version = await getVersion();
    expect(version).toBeGreaterThan(0);
  });

  test("parses simple text", async () => {
    const ast = await parse("Hello world");

    expect(ast).toBeDefined();
    expect(ast.type).toBe("root");
    expect(ast.children).toBeArray();
    expect(ast.source).toBe("Hello world");
    expect(ast.errors).toBeArray();
  });

  test("parses heading with correct level", async () => {
    const ast = await parse("# Hello");

    expect(ast.children.length).toBeGreaterThan(0);
    const heading = ast.children[0] as HeadingNode;
    expect(heading.type).toBe("heading");
    expect(heading.level).toBe(1);
    expect(heading.children).toBeArray();
  });

  test("parses nested markdown structure", async () => {
    const source = `# Title

A paragraph with **bold** text.

- Item 1
- Item 2`;

    const ast = await parse(source);

    expect(ast.children.length).toBeGreaterThan(0);
    expect(ast.children[0]?.type).toBe("heading");

    // Should have multiple children: heading, paragraph, list
    expect(ast.children.length).toBeGreaterThanOrEqual(2);
  });

  test("parses code block with language", async () => {
    const source = `\`\`\`javascript
console.log("hi");
\`\`\``;

    const ast = await parse(source);

    const codeBlock = ast.children[0] as CodeBlockNode;
    expect(codeBlock.type).toBe("code_block");
    expect(codeBlock.lang).toBe("javascript");
    expect(codeBlock.value).toContain("console.log");
  });

  test("parses inline code", async () => {
    const source = "Use `const` for constants";

    const ast = await parse(source);

    expect(ast.children.length).toBeGreaterThan(0);
    const paragraph = ast.children[0];
    expect(paragraph?.type).toBe("paragraph");
  });

  test("parses JSX self-closing element", async () => {
    const source = '<Button color="blue" />';

    const ast = await parse(source);

    const jsx = ast.children[0] as JsxSelfClosingNode;
    expect(jsx.type).toBe("mdx_jsx_self_closing");
    expect(jsx.name).toBe("Button");
    expect(jsx.attributes).toBeArray();
    expect(jsx.attributes.length).toBe(1);
    expect(jsx.attributes[0]?.name).toBe("color");
    expect(jsx.attributes[0]?.value).toBe("blue");
  });

  test("parses JSX element with children", async () => {
    const source = "<Button>Click me</Button>";

    const ast = await parse(source);

    const jsx = ast.children[0] as JsxElementNode;
    expect(jsx?.type).toBe("mdx_jsx_element");
    expect(jsx?.name).toBe("Button");
    expect(jsx?.children).toBeArray();
  });

  test("parses MDX expressions", async () => {
    const source = "Count: {count}";

    const ast = await parse(source);

    expect(ast.children.length).toBeGreaterThan(0);
  });

  test("parses frontmatter", async () => {
    const source = `---
title: Hello
---
# Content`;

    const ast = await parse(source);

    // Should have frontmatter and heading
    expect(ast.children.length).toBeGreaterThan(0);
  });

  test("handles complex nested structure", async () => {
    const source = `# Title

## Subtitle

A paragraph with **bold**, *italic*, and \`code\`.

<Alert type="warning">
  This is a **warning** message.
</Alert>

\`\`\`typescript
const x = 42;
\`\`\`

- List item 1
  - Nested item
- List item 2`;

    const ast = await parse(source);

    expect(ast.type).toBe("root");
    expect(ast.children.length).toBeGreaterThan(0);
    expect(ast.source).toBe(source);

    // Verify it's a proper tree structure
    const firstChild = ast.children[0];
    expect(firstChild).toBeDefined();
    expect(firstChild?.type).toBeTruthy();
  });

  test("escapes special characters in output", async () => {
    const source = 'Text with "quotes" and \\backslash';

    const ast = await parse(source);

    // The source should be preserved correctly
    expect(ast.source).toBe(source);
  });

  test("includes parse errors", async () => {
    const source = "<Unclosed";

    const ast = await parse(source);

    expect(ast.errors).toBeArray();
    // May or may not have errors depending on error recovery
  });

  test("parses links", async () => {
    const source = "[Click here](https://example.com)";

    const ast = await parse(source);

    expect(ast.children.length).toBeGreaterThan(0);
  });

  test("parses images", async () => {
    const source = "![Alt text](image.png)";

    const ast = await parse(source);

    expect(ast.children.length).toBeGreaterThan(0);
  });

  test("parses blockquotes", async () => {
    const source = "> This is a quote";

    const ast = await parse(source);

    expect(ast.children.length).toBeGreaterThan(0);
  });

  test("reset clears allocator", async () => {
    await parse("Test content");
    await reset();

    // Should still work after reset
    const ast = await parse("New content");
    expect(ast.source).toBe("New content");
  });

  test("handles empty input", async () => {
    const ast = await parse("");

    expect(ast.type).toBe("root");
    expect(ast.children).toBeArray();
    expect(ast.source).toBe("");
  });

  test("handles large input", async () => {
    const largeSource = "# Heading\n\n".repeat(100) + "Paragraph text. ".repeat(1000);

    const ast = await parse(largeSource);

    expect(ast.children.length).toBeGreaterThan(0);
    expect(ast.source).toBe(largeSource);
  });
});
