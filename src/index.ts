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

// JID Owner Eksplisit
const OWNER_JID = "6287755893014@s.whatsapp.net";

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: !CONFIG.usePairingCode,
    logger: require('pino')({ level: 'silent' }),
    // Tambahkan ini untuk memastikan sinkronisasi pesan lebih baik
    syncFullHistory: true,
    // Pastikan bot bisa membaca pesan dari diri sendiri
    markOnlineOnConnect: true 
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
      console.log('Bot is now connected - Login sebagai:', OWNER_JID);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }: any) => {
    // Kita pantau semua pesan yang masuk (notify maupun append)
    for (const msg of messages) {
      if (!msg.message) continue;

      // Ambil sender. Jika 'fromMe' true, berarti pengirimnya adalah kita sendiri
      const isFromMe = msg.key.fromMe;
      const rawSender = msg.key.participant || msg.key.remoteJid || "";
      const cleanSender = jidNormalizedUser(rawSender);

      let text = "";
      if (msg.message.conversation) text = msg.message.conversation;
      else if (msg.message.extendedTextMessage) text = msg.message.extendedTextMessage.text;

      if (!text) continue;

      // Log setiap teks yang masuk untuk mempermudah tracking di terminal
      console.log(`[INCOMING] From: ${cleanSender} | Self: ${isFromMe} | Text: ${text}`);

      if (text.toLowerCase() === "cantik") {
        
        // Pengecekan Owner: Jika pesan berasal dari kita sendiri (fromMe) 
        // ATAU sender ID cocok dengan OWNER_JID
        const isOwner = isFromMe || cleanSender === OWNER_JID;

        if (!isOwner) continue;

        console.log(`[PROCESS] Perintah 'ulang' tervalidasi. Mencari media...`);

        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quotedMsg) {
          console.log(`[DEBUG] Gagal: Tidak ada media yang di-reply.`);
          continue;
        }

        let mediaMessage: any;
        let mediaType: any;

        // Support View Once
        const viewOnce = quotedMsg.viewOnceMessageV2?.message || quotedMsg.viewOnceMessage?.message;
        const targetMsg = viewOnce || quotedMsg;

        if (targetMsg.imageMessage) { mediaMessage = targetMsg.imageMessage; mediaType = 'image'; }
        else if (targetMsg.videoMessage) { mediaMessage = targetMsg.videoMessage; mediaType = 'video'; }
        else if (targetMsg.stickerMessage) { mediaMessage = targetMsg.stickerMessage; mediaType = 'sticker'; }
        else if (targetMsg.documentMessage) { mediaMessage = targetMsg.documentMessage; mediaType = 'document'; }
        else if (targetMsg.audioMessage) { mediaMessage = targetMsg.audioMessage; mediaType = 'audio'; }

        if (mediaMessage && mediaType) {
          try {
            console.log(`[DOWNLOAD] Sedang mengunduh ${mediaType}...`);
            const stream = await downloadContentFromMessage(mediaMessage, mediaType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
              buffer = Buffer.concat([buffer, chunk]);
            }

            console.log(`[SEND] Mengirim ke ${OWNER_JID}...`);
            
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

            console.log(`[SUCCESS] Media berhasil dikirim.`);
          } catch (err) {
            console.error("[ERROR] Gagal proses media:", err);
          }
        }
      }
    }
  });
}

startSock();