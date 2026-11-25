/** `GET /telegram/link`: whether the server has the bot on, and whether this user is linked. Dates are ISO strings. */
export interface TelegramLinkStatus {
  readonly enabled: boolean;
  readonly botUsername: string | null;
  readonly linked: boolean;
  readonly telegramUsername: string | null;
  readonly linkedAt: string | null;
}

/** `POST /telegram/link`: a one-time link that opens the bot; valid until `expiresAt`. */
export interface TelegramDeepLink {
  readonly deepLink: string;
  readonly expiresAt: string;
}
