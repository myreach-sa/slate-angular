export function useMutationObserver(
  node: HTMLElement,
  callback: MutationCallback,
  options: MutationObserverInit
) {
  const mutationObserver = new MutationObserver(callback);

  const afterRenderPhase = () => {
    const record = mutationObserver.takeRecords();
    console.log("DEBUG5 afterRenderPhase", record);
  };

  afterRenderPhase();

  if (!node) {
    throw new Error("Failed to attach MutationObserver, `node` is undefined");
  }

  mutationObserver.observe(node, options);

  const disconnect = () => mutationObserver.disconnect();

  return { afterRenderPhase, disconnect };
}
