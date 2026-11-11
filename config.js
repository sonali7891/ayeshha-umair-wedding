/* Deployment configuration for the Ayesha Mansuri wedding album.
 *
 * The album app runs in two places:
 *   - On the Oracle Always Free VM (same-origin, everything local).
 *   - On GitHub Pages: the app UI and the small grid thumbnails are served
 *     from GitHub's global CDN, while the large lightbox previews and the
 *     untouched 24MP originals are streamed from the Oracle Always Free VM.
 *
 * This copy is the GitHub Pages deployment.
 */
window.ALBUM_ORIGIN = 'https://80.225.243.26.nip.io/wedding';
window.ALBUM_THUMB_ORIGIN = '';         // thumbnails: served by GitHub Pages
window.ALBUM_PREVIEW_ORIGIN = '';       // previews: served by the Oracle VM
