/** Rearranges items so [left, k] contains the smallest values. ISC: Vladimir Agafonkin. */
export default function quickselect(arr, k, left = 0, right = arr.length - 1, compare = defaultCompare) {
  while (right > left) {
    if (right - left > 600) {
      const n = right - left + 1;
      const m = k - left + 1;
      const z = Math.log(n);
      const s = 0.5 * Math.exp(2 * z / 3);
      const sd = 0.5 * Math.sqrt(z * s * (n - s) / n) * (m - n / 2 < 0 ? -1 : 1);
      const newLeft = Math.max(left, Math.floor(k - m * s / n + sd));
      const newRight = Math.min(right, Math.floor(k + (n - m) * s / n + sd));
      quickselect(arr, k, newLeft, newRight, compare);
    }
    const target = arr[k];
    let i = left; let j = right;
    swap(arr, left, k);
    if (compare(arr[right], target) > 0) swap(arr, left, right);
    while (i < j) {
      swap(arr, i, j); i += 1; j -= 1;
      while (compare(arr[i], target) < 0) i += 1;
      while (compare(arr[j], target) > 0) j -= 1;
    }
    if (compare(arr[left], target) === 0) swap(arr, left, j);
    else { j += 1; swap(arr, j, right); }
    if (j <= k) left = j + 1;
    if (k <= j) right = j - 1;
  }
}

function swap(values, left, right) { const value = values[left]; values[left] = values[right]; values[right] = value; }
function defaultCompare(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
