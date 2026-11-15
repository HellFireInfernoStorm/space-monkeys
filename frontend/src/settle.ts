/**
 * Runs `commit` with the latest value once values stop arriving for `ms` milliseconds.
 * `cancel` drops a value still waiting, for when the value is set from elsewhere
 * (a new wavelength range, the Back button) and the waiting one is out of date.
 */
export function settler<T>(ms: number, commit: (value: T) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    schedule(value: T) {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        commit(value);
      }, ms);
    },
    cancel,
  };
}
