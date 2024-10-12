process.on('uncaughtException', console.error)
const {
  default: WAConnect,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
  Browsers, 
  fetchLatestWaWebVersion
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const readline = require('readline');
const { Boom } = require("@hapi/boom");
const settings = require('./settings'); // Import settings.js
const cfonts = require('cfonts'); // Import cfonts
const { random } = require('lodash'); // Import lodash

const pairingCode = process.argv.includes("--pairing-code");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));
const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });

// Fungsi untuk menghasilkan warna acak
function randomColor() {
  const colors = ['red', 'green', 'blue', 'yellow', 'magenta', 'cyan'];
  return colors[random(0, colors.length - 1)];
}

// Fungsi untuk menampilkan teks dengan warna
function colorText(text, color) {
  let colorCode = {
    'red': '\x1b[31m',
    'green': '\x1b[32m',
    'yellow': '\x1b[33m',
    'blue': '\x1b[34m',
    'magenta': '\x1b[35m',
    'cyan': '\x1b[36m',
    'white': '\x1b[37m',
  }[color];

  return `${colorCode}${text}\x1b[0m`; // Reset warna
}

async function WAStart() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState("./sesi");

    // Tampilkan teks dengan cfonts
    cfonts.say('auto-read-sw\nby-wily-kun', { // Tampilkan teks dengan cfonts
      font: 'tiny',       
      align: 'center',
      colors: [randomColor()], // Gunakan warna acak
      background: 'transparent', 
      letterSpacing: 1,
      lineHeight: 1,
      space: true,
      maxLength: '0',
      gradient: false,
      independentGradient: false,
      transitionGradient: false,
      env: 'node'
    });

    // Tampilkan daftar fitur dengan status aktif/tidak aktif
    console.log("---------- Daftar Fitur ----------");
    console.log(colorText("1. Auto Read Status: ", 'blue') + (settings.autoReadStory ? colorText("✅ Aktif", 'green') : colorText("❌ Tidak Aktif", 'red')));
    console.log(colorText("2. Auto Typing: ", 'blue') + (settings.autoTyping ? colorText("✅ Aktif", 'green') : colorText("❌ Tidak Aktif", 'red')));
    console.log(colorText("3. Update Bio (Aktif Selama Uptime): ", 'blue') + (settings.bioActive ? colorText("✅ Aktif", 'green') : colorText("❌ Tidak Aktif", 'red')));
    console.log("----------------------------------"); // Garis pemisah dengan panjang sama

    // Sekarang tampilkan versi WA setelah daftar fitur
    const { version, isLatest } = await fetchLatestWaWebVersion().catch(() => fetchLatestBaileysVersion());
    console.log("menggunakan WA v" + version.join(".") + ", isLatest: " + isLatest); 

    const client = WAConnect({
      logger: pino({ level: "silent" }),
      printQRInTerminal: !pairingCode,
      browser: Browsers.ubuntu("Chrome"),
      auth: state,
    });

    store.bind(client.ev);

    if (pairingCode && !client.authState.creds.registered) {
      const phoneNumber = await question("Silahkan masukin nomor Whatsapp kamu: ");
      let code = await client.requestPairingCode(phoneNumber);
      code = code?.match(/.{1,4}/g)?.join("-") || code;
      console.log("⚠︎ Kode Whatsapp kamu : " + code);
    }

    // Variabel untuk menyimpan waktu mulai bot
    let startTime = Date.now();

    // Fungsi untuk menghitung uptime
    function calculateUptime() {
      const now = Date.now();
      const uptimeMs = now - startTime;
      const seconds = Math.floor(uptimeMs / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      let uptimeString = "";
      if (days > 0) {
        uptimeString += days + " hari ";
      }
      if (hours % 24 > 0) {
        uptimeString += hours % 24 + " jam ";
      }
      if (minutes % 60 > 0) {
        uptimeString += minutes % 60 + " menit ";
      }
      uptimeString += seconds % 60 + " detik ";

      return uptimeString;
    }

    // Fungsi untuk mengatur kecepatan melihat status
    function setReadStatusSpeed(speed) {
      if (speed < 1000) {
        console.log("Kecepatan minimal 1 detik (1000 milidetik).");
        return 1000;
      } else {
        return speed;
      }
    }

    // Atur kecepatan awal (sekarang dari settings.js)
    let readStatusSpeed = settings.readStatusSpeed;

    // Update Bio
    let bioInterval = setInterval(async () => {
      if (settings.bioActive) { // Periksa nilai bioActive dari settings.js
        const uptimeText = calculateUptime();
        await client.updateProfileStatus("Aktif Selama " + uptimeText + " ⏳");
      } 
    }, 10000); // Update bio every 10 seconds

    client.ev.on("messages.upsert", async (chatUpdate) => {
      try {
        const m = chatUpdate.messages[0];
        if (!m.message) return;
        if (m.key && !m.key.fromMe && m.key.remoteJid === 'status@broadcast' && settings.autoReadStory) { // Periksa nilai autoReadStory
          // Membaca cerita
          client.readMessages([m.key]);
          console.log("AUTO LIHAT STATUS ✅", m.key.participant.split('@')[0]); // Diganti
          // Tunggu sebelum membaca status berikutnya
          await new Promise(resolve => setTimeout(resolve, readStatusSpeed));
        }

        // Kirim pesan "Typing..." jika autoTyping diaktifkan
        if (settings.autoTyping && !m.key.fromMe) {
            await client.sendPresenceUpdate("composing", m.key.remoteJid);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Tunggu 1 detik
            await client.sendPresenceUpdate("paused", m.key.remoteJid);
        }
      } catch (err) {
        console.log(err);
      }
    });

    // ... (sisa kode koneksi dan penanganan event)

    client.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === "close") {
        // Stop bio update when bot disconnects
        if (bioInterval) {
          clearInterval(bioInterval);
        }

        let reason = new Boom(lastDisconnect?.error)?.output.statusCode;
        if (reason === DisconnectReason.badSession) {
          console.log("File Sesi Buruk, Silahkan Hapus Sesi dan Pindai Lagi");
          process.exit();
        } else if (reason === DisconnectReason.connectionClosed) {
          console.log("Koneksi ditutup, menyambung kembali....");
          WAStart();
        } else if (reason === DisconnectReason.connectionLost) {
          console.log("Koneksi Hilang dari Server, menyambung kembali...");
          WAStart();
        } else if (reason === DisconnectReason.connectionReplaced) {
          console.log("Koneksi Diganti, Sesi Baru Dibuka, Silahkan Mulai Ulang Bot");
          process.exit();
        } else if (reason === DisconnectReason.loggedOut) {
          console.log("Perangkat Keluar, Silahkan Hapus Folder Sesi dan Pindai Lagi.");
          process.exit();
        } else if (reason === DisconnectReason.restartRequired) {
          console.log("Mulai Ulang Diperlukan, Memulai Ulang...");
          WAStart();
        } else if (reason === DisconnectReason.timedOut) {
          console.log("Koneksi Habis Waktu, Menyambung Kembali...");
          WAStart();
        } else {
          console.log("Alasan Disconnect Tidak Diketahui: " + reason + "|" + connection);
          WAStart();
        }
      } else if (connection === "open") {
        console.log("Terhubung ke Readsw");
      }
    });

    client.ev.on("creds.update", saveCreds);

    return client;
  } catch (error) {
    console.error("Terjadi kesalahan:", error);
    process.exit(1); // Keluar dengan kode kesalahan
  }
}

WAStart();
