/** Product + assistant names — change them in /brand.json only (appName also drives the Android label via app.config.js). */
import brand from '../../brand.json';

export const APP_NAME: string = brand.appName;
/** Assistant persona (friendly, upbeat, quick). */
export const ASSISTANT_NAME: string = brand.assistantName;
export const ASK_ASSISTANT = `Ask ${APP_NAME}`;
