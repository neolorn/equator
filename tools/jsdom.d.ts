/**
 * The part of jsdom the tools use, as jsdom's README describes it: a document parsed from text, as
 * HTML or, under an XML content type, as XML. jsdom publishes no declarations of its own, so what a
 * tool reaches beyond this is a compiler error rather than a guess.
 */
declare module 'jsdom' {
  export interface ConstructorOptions {
    /** How the text is parsed: an HTML MIME type parses HTML, an XML one XML. */
    readonly contentType?: string;
  }

  export class JSDOM {
    constructor(html?: string, options?: ConstructorOptions);
    readonly window: Window;
  }
}
