// Preserve the captured picker, selection prompts and template identities.
// Only the five fixed export notes are derived after checking all source bytes.
export const pickerPresentationReferences = Object.freeze({
  'creative-picker': '2a07bc2e7e3874c49f012f1022cbf838939bf8ea502ca33af31b277986dadcc9',
  'website-design-picker': '2a07bc2e7e3874c49f012f1022cbf838939bf8ea502ca33af31b277986dadcc9',
  'motion-picker': '11addd0cd6cdf70ec7896452ea607ce3dc9800d95c0e0279c7cc30fdd7e2ff33',
});
const notes = [
  ['Use screen recording for video for now. Video export is coming soon.', 'This panel provides interactive previews. Use screen recording to save video; video export is not available.'],
  ['目前建议通过录屏保存为视频，视频导出功能即将上线。', '此处提供交互预览；可录屏保存，暂不提供视频导出。'],
  ['現在は画面録画で動画を保存してください。動画書き出しは近日対応予定です。', 'ここではインタラクティブなプレビューを利用できます。動画は画面録画で保存してください。動画の書き出しには対応していません。'],
  ['현재는 화면 녹화로 영상을 저장하세요. 영상 내보내기는 곧 지원됩니다.', '이 패널은 인터랙티브 미리보기를 제공합니다. 화면 녹화로 영상을 저장할 수 있으며, 영상 내보내기는 제공되지 않습니다.'],
  ['Utilisez l’enregistrement d’écran pour la vidéo. L’export vidéo arrive bientôt.', 'Ce panneau propose des aperçus interactifs. Utilisez l’enregistrement d’écran pour sauvegarder une vidéo ; l’export vidéo n’est pas disponible.'],
];
export async function localizePickerPresentation(html, name, version) {
  if (!Object.hasOwn(pickerPresentationReferences, name)) return html;
  if (version !== 'v1') throw Error('unsupported local picker presentation version');
  if (typeof html !== 'string') throw Error('picker presentation must be captured HTML');
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(html));
  const hash = [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== pickerPresentationReferences[name]) throw Error('picker presentation reference integrity mismatch');
  for (const [index, [original, local]] of notes.entries()) {
    // Creative has its static note, locale and fallback; Motion has only its locale.
    const expectedCount = index === 0 && name !== 'motion-picker' ? 3 : 1;
    if (html.split(original).length !== expectedCount + 1) throw Error('picker export note integrity mismatch');
    html = html.replaceAll(original, local);
  }
  return html;
}
