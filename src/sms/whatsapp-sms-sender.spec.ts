import {
  WhatsappSendError,
  type GreenApiCredentials,
} from './green-api-client.js';
import { WhatsappSmsSender } from './whatsapp-sms-sender.js';

const CREDENTIALS = { instanceId: '7103123456', token: 'a'.repeat(50) };
const PHONE = '+22376000000';
const TEXT = 'Bâtisso : votre code est 123456';

function setup(credentials: GreenApiCredentials | null) {
  const settings = {
    deliveryCredentials: vi.fn().mockResolvedValue(credentials),
  };
  const fallback = { send: vi.fn().mockResolvedValue(undefined) };
  const sendWhatsapp = vi.fn().mockResolvedValue(undefined);
  const sender = new WhatsappSmsSender(settings, fallback, sendWhatsapp);
  return { sender, settings, fallback, sendWhatsapp };
}

describe('WhatsappSmsSender', () => {
  it('sends over WhatsApp with the saved credentials when it is on', async () => {
    const { sender, fallback, sendWhatsapp } = setup(CREDENTIALS);

    await sender.send(PHONE, TEXT);

    expect(sendWhatsapp).toHaveBeenCalledWith(CREDENTIALS, PHONE, TEXT);
    expect(fallback.send).not.toHaveBeenCalled();
  });

  it('goes the old way (console sender) when WhatsApp is not usable', async () => {
    // Off, no instance, no token or an unreadable one: deliveryCredentials is null.
    const { sender, fallback, sendWhatsapp } = setup(null);

    await sender.send(PHONE, TEXT);

    expect(fallback.send).toHaveBeenCalledWith(PHONE, TEXT);
    expect(sendWhatsapp).not.toHaveBeenCalled();
  });

  it('passes the console failure on too (production without WhatsApp)', async () => {
    const { sender, fallback } = setup(null);
    const failure = new Error('No SMS provider');
    fallback.send.mockRejectedValue(failure);

    await expect(sender.send(PHONE, TEXT)).rejects.toBe(failure);
  });

  it('rejects a Green API failure to the caller, never falling back', async () => {
    const { sender, fallback, sendWhatsapp } = setup(CREDENTIALS);
    const failure = new WhatsappSendError('HTTP 466');
    sendWhatsapp.mockRejectedValue(failure);

    await expect(sender.send(PHONE, TEXT)).rejects.toBe(failure);
    expect(fallback.send).not.toHaveBeenCalled();
  });

  it('reads the settings for every message, so a change applies at once', async () => {
    const { sender, settings } = setup(null);

    await sender.send(PHONE, TEXT);
    await sender.send(PHONE, TEXT);

    expect(settings.deliveryCredentials).toHaveBeenCalledTimes(2);
  });
});
