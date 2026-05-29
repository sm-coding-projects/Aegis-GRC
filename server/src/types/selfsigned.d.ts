declare module 'selfsigned' {
  interface Attribute {
    name: string;
    value: string;
  }
  interface AltName {
    type: number;
    value?: string;
    ip?: string;
  }
  interface Extension {
    name: string;
    altNames?: AltName[];
    [key: string]: unknown;
  }
  interface Options {
    keySize?: number;
    days?: number;
    algorithm?: string;
    extensions?: Extension[];
  }
  interface Pems {
    private: string;
    public: string;
    cert: string;
  }
  export function generate(attrs?: Attribute[], opts?: Options): Pems;
  const _default: { generate: typeof generate };
  export default _default;
}
