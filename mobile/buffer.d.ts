// WDK core ships TypeScript source that names the global Buffer type; TS 6 no
// longer pulls in Node's globals, so declare it from the `buffer` package it uses.
type Buffer = import('buffer').Buffer;
declare var Buffer: typeof import('buffer').Buffer;
