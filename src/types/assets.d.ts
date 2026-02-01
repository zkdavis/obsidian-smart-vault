declare module "*.wasm" {
    const value: Uint8Array;
    export default value;
}

declare module "*.workerjs" {
    const value: string;
    export default value;
}
