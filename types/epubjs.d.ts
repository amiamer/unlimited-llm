declare module 'epubjs' {
  interface SpineItem {
    href: string;
    index: number;
    load: (loader: any) => Promise<void>;
    document?: Document;
  }

  interface Spine {
    spineItems: SpineItem[];
    get(index: number): SpineItem | undefined;
    length: number;
  }

  interface Navigation {
    toc: any[];
  }

  interface Book {
    ready: Promise<void>;
    spine: Spine;
    loaded: {
      navigation: Promise<Navigation>;
    };
    load: {
      bind: (context: any) => any;
    };
    renderTo(element: HTMLElement, options: any): Rendition;
    destroy(): void;
  }

  interface Rendition {
    display(target?: string | number): Promise<void>;
    next(): Promise<void>;
    prev(): Promise<void>;
    on(event: string, callback: (...args: any[]) => void): void;
    off(event: string, callback: (...args: any[]) => void): void;
    themes: {
      default(styles: Record<string, string>): void;
      fontSize(size: string): void;
    };
    destroy(): void;
  }

  function ePub(url: string, options?: any): Book;

  export default ePub;
}
