import makeWASocket, { 
  useMultiFileAuthState, 
  fetchLatestBaileysVersion, 
  DisconnectReason, 
  downloadContentFromMessage,
  jidNormalizedUser 
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import * as qrcode from 'qrcode-terminal';

const CONFIG = {
  phoneNumber: "6287755893014",
  usePairingCode: true
};

// JID dan LID kamu secara eksplisit dari log sebelumnya
const OWNER_JID = "6285159884234@s.whatsapp.net";
const OWNER_LID = "276252363632838@lid";

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: !CONFIG.usePairingCode,
    logger: require('pino')({ level: 'silent' })
  });

  if (CONFIG.usePairingCode && !sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(CONFIG.phoneNumber);
        console.log(`\nKODE PAIRING: ${code?.match(/.{1,4}/g)?.join("-")}\n`);
      } catch (err) {
        console.error("Gagal pairing:", err);
      }
    }, 3000);
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update: any) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) startSock();
    } else if (connection === 'open') {
      console.log('Bot is now connected');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }: any) => {
    for (const msg of messages) {
      if (!msg.message) continue;

      const from = msg.key.remoteJid!;
      // Ambil sender dan bersihkan formatnya (menghilangkan :1, :2 dll)
      const sender = jidNormalizedUser(msg.key.participant || msg.key.remoteJid || "");

      let text = "";
      if (msg.message.conversation) text = msg.message.conversation;
      else if (msg.message.extendedTextMessage) text = msg.message.extendedTextMessage.text;

      if (!text) continue;

      // Filter: Hanya proses perintah "ulang"
      if (text.toLowerCase() === "ulang") {
        // Log Debug untuk memastikan siapa yang mengirim
        console.log(`[DEBUG] Perintah 'ulang' terdeteksi dari: ${sender}`);

        // Cek apakah sender adalah JID atau LID owner
        const isOwner = (sender === OWNER_JID || sender === OWNER_LID);

        if (!isOwner) {
          console.log(`[DEBUG] Akses ditolak untuk: ${sender}`);
          continue; 
        }

        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quotedMsg) {
          console.log(`[DEBUG] Perintah 'ulang' diketik tanpa me-reply media.`);
          continue;
        }

        let mediaMessage: any;
        let mediaType: any;

        // Cek View Once atau Media Biasa
        const viewOnce = quotedMsg.viewOnceMessageV2?.message || quotedMsg.viewOnceMessage?.message;
        const targetMsg = viewOnce || quotedMsg;

        if (targetMsg.imageMessage) { mediaMessage = targetMsg.imageMessage; mediaType = 'image'; }
        else if (targetMsg.videoMessage) { mediaMessage = targetMsg.videoMessage; mediaType = 'video'; }
        else if (targetMsg.stickerMessage) { mediaMessage = targetMsg.stickerMessage; mediaType = 'sticker'; }
        else if (targetMsg.documentMessage) { mediaMessage = targetMsg.documentMessage; mediaType = 'document'; }
        else if (targetMsg.audioMessage) { mediaMessage = targetMsg.audioMessage; mediaType = 'audio'; }

        if (mediaMessage && mediaType) {
          try {
            console.log(`[PROCESS] Mendownload media tipe ${mediaType}...`);
            const stream = await downloadContentFromMessage(mediaMessage, mediaType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
              buffer = Buffer.concat([buffer, chunk]);
            }

            // Selalu kirim ke JID Owner (pribadi)
            if (mediaType === 'image') {
              await sock.sendMessage(OWNER_JID, { image: buffer, caption: "Extract Berhasil" });
            } else if (mediaType === 'video') {
              await sock.sendMessage(OWNER_JID, { video: buffer, caption: "Extract Berhasil" });
            } else if (mediaType === 'sticker') {
              await sock.sendMessage(OWNER_JID, { sticker: buffer });
            } else if (mediaType === 'audio') {
              await sock.sendMessage(OWNER_JID, { audio: buffer, mimetype: 'audio/mp4', ptt: mediaMessage.ptt });
            } else {
              await sock.sendMessage(OWNER_JID, { document: buffer, mimetype: mediaMessage.mimetype, fileName: mediaMessage.fileName || 'file' });
            }

            console.log(`[SUCCESS] Media berhasil dikirim ke nomor owner (${OWNER_JID})`);
          } catch (err) {
            console.error("[ERROR] Gagal saat mengekstrak media:", err);
          }
        }
      }
    }
  });
}

startSock();