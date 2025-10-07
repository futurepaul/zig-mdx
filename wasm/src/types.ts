/**
 * Type definitions for zig-mdx WASM exports and AST
 */

export interface WasmExports {
  memory: WebAssembly.Memory;
  wasm_init(): void;
  wasm_get_version(): number;
  wasm_alloc(size: number): number;
  wasm_free(ptr: number, size: number): void;
  wasm_parse_mdx(
    sourcePtr: number,
    sourceLen: number,
    outJsonPtr: number,
    outJsonLen: number
  ): boolean;
  wasm_reset(): void;
}

export interface Token {
  tag: string;
  start: number;
  end: number;
}

export interface ParseError {
  tag: string;
  token: number;
}

export interface BaseNode {
  index: number;
  type: string;
  mainToken: number;
}

export interface DocumentNode extends BaseNode {
  type: "document";
  children: number[];
}

export interface ParagraphNode extends BaseNode {
  type: "paragraph";
  children: number[];
}

export interface HeadingNode extends BaseNode {
  type: "heading";
  level: number;
  childrenStart: number;
  childrenEnd: number;
}

export interface TextNode extends BaseNode {
  type: "text";
  text: string;
}

export interface LinkNode extends BaseNode {
  type: "link";
  url: string;
  title?: string;
  childrenStart: number;
  childrenEnd: number;
}

export interface ImageNode extends BaseNode {
  type: "image";
  url: string;
  title?: string;
  childrenStart: number;
  childrenEnd: number;
}

export interface CodeBlockNode extends BaseNode {
  type: "code_block";
  lang?: string;
  text: string;
}

export interface InlineCodeNode extends BaseNode {
  type: "code_inline";
  text: string;
}

export interface BlockquoteNode extends BaseNode {
  type: "blockquote";
  children: number[];
}

export interface ListNode extends BaseNode {
  type: "list_unordered" | "list_ordered";
  children: number[];
}

export interface ListItemNode extends BaseNode {
  type: "list_item";
  children: number[];
}

export interface JsxElementNode extends BaseNode {
  type: "mdx_jsx_element" | "mdx_jsx_self_closing";
  name: string;
  children?: number[];
}

export interface JsxFragmentNode extends BaseNode {
  type: "mdx_jsx_fragment";
  children: number[];
}

export interface MdxTextExpressionNode extends BaseNode {
  type: "mdx_text_expression";
}

export interface MdxFlowExpressionNode extends BaseNode {
  type: "mdx_flow_expression";
}

export interface EmphasisNode extends BaseNode {
  type: "emphasis";
  children: number[];
}

export interface StrongNode extends BaseNode {
  type: "strong";
  children: number[];
}

export interface HardBreakNode extends BaseNode {
  type: "hard_break";
}

export interface SoftBreakNode extends BaseNode {
  type: "soft_break";
}

export interface ThematicBreakNode extends BaseNode {
  type: "thematic_break";
}

export interface HtmlBlockNode extends BaseNode {
  type: "html_block";
  text: string;
}

export interface HtmlInlineNode extends BaseNode {
  type: "html_inline";
  text: string;
}

export interface FrontmatterNode extends BaseNode {
  type: "frontmatter";
  text: string;
}

export type Node =
  | DocumentNode
  | ParagraphNode
  | HeadingNode
  | TextNode
  | LinkNode
  | ImageNode
  | CodeBlockNode
  | InlineCodeNode
  | BlockquoteNode
  | ListNode
  | ListItemNode
  | JsxElementNode
  | JsxFragmentNode
  | MdxTextExpressionNode
  | MdxFlowExpressionNode
  | EmphasisNode
  | StrongNode
  | HardBreakNode
  | SoftBreakNode
  | ThematicBreakNode
  | HtmlBlockNode
  | HtmlInlineNode
  | FrontmatterNode
  | BaseNode;

export interface AST {
  nodes: Node[];
  tokens: Token[];
  errors: ParseError[];
  source: string;
}
