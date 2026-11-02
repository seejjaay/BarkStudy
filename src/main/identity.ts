/**
 * The names Windows and the updater know the app by. `appId` and the userData folder never change after the first public
 * release: changing either breaks auto-update and orphans everyone's decks. `electron-builder.yml` repeats appId and
 * productName, and `tests/main/identity.test.ts` fails if the two drift apart. See `docs/release.md`.
 */
export const APP_ID = 'io.github.seejjaay.barkstudy';
export const PRODUCT_NAME = 'BarkStudy';
/** The folder under %APPDATA% that holds the decks, history, settings and logs. Pinned, so a rename of the app never moves it. */
export const USER_DATA_NAME = 'BarkStudy';
