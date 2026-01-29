// Helper to buffer
const str2ab = (str) => {
  const buf = new ArrayBuffer(str.length);
  const bufView = new Uint8Array(buf);
  for (let i = 0, strLen = str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
};

const ab2str = (buf) => {
  return String.fromCharCode.apply(null, new Uint8Array(buf));
};

const importPublicKey = async (pem) => {
  const binaryDer = str2ab(atob(pem));
  return window.crypto.subtle.importKey(
    "spki",
    binaryDer,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["encrypt"]
  );
};

const importPrivateKey = async (pem) => {
  const binaryDer = str2ab(atob(pem));
  return window.crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["decrypt"]
  );
};

export const encryptMessage = async (publicKeyPem, text, senderPublicKeyPem = null) => {
  try {
    if (!publicKeyPem) return text;

    // 1. Generate AES Session Key
    const sessionKey = await window.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt"]
    );

    // 2. Encrypt Text with AES
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const encodedText = enc.encode(text);
    
    const encryptedContent = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      sessionKey,
      encodedText
    );

    // 3. Encrypt Session Key with Recipient's RSA Public Key
    const publicKey = await importPublicKey(publicKeyPem);
    const sessionKeyRaw = await window.crypto.subtle.exportKey("raw", sessionKey);
    
    const encryptedSessionKey = await window.crypto.subtle.encrypt(
      { name: "RSA-OAEP" },
      publicKey,
      sessionKeyRaw
    );

    // 4. ALSO Encrypt Session Key with Sender's RSA Public Key (for history)
    let encryptedSenderKey = null;
    if (senderPublicKeyPem) {
        const senderPublicKey = await importPublicKey(senderPublicKeyPem);
        const senderSessionKeyRaw = await window.crypto.subtle.encrypt(
            { name: "RSA-OAEP" },
            senderPublicKey,
            sessionKeyRaw
        );
        encryptedSenderKey = btoa(ab2str(senderSessionKeyRaw));
    }

    // 5. Package it all
    const payload = {
      iv: btoa(ab2str(iv)),
      content: btoa(ab2str(encryptedContent)),
      key: btoa(ab2str(encryptedSessionKey)),
      sKey: encryptedSenderKey // Store the sender's copy
    };

    return JSON.stringify(payload);
  } catch (error) {
    console.error("Encryption failed:", error);
    return text;
  }
};

export const decryptMessage = async (privateKeyPem, encryptedJson) => {
  try {
    let payload;
    try {
        payload = JSON.parse(encryptedJson);
    } catch {
        return encryptedJson;
    }

    if (!payload.iv || !payload.content) return encryptedJson;

    // 1. Import Private Key
    const privateKey = await importPrivateKey(privateKeyPem);

    // 2. Decrypt Session Key (Try Recipient Key first, then Sender Key)
    let decryptedSessionKeyRaw;
    try {
        const encryptedSessionKey = str2ab(atob(payload.key));
        decryptedSessionKeyRaw = await window.crypto.subtle.decrypt(
          { name: "RSA-OAEP" },
          privateKey,
          encryptedSessionKey
        );
    } catch (e) {
        // If recipient key fails, try the sender key (sKey)
        if (payload.sKey) {
            const encryptedSenderKey = str2ab(atob(payload.sKey));
            decryptedSessionKeyRaw = await window.crypto.subtle.decrypt(
              { name: "RSA-OAEP" },
              privateKey,
              encryptedSenderKey
            );
        } else {
            throw new Error("Could not decrypt with any available keys");
        }
    }

    // 3. Import Session Key and Decrypt Content
    const sessionKey = await window.crypto.subtle.importKey(
      "raw",
      decryptedSessionKeyRaw,
      { name: "AES-GCM" },
      true,
      ["decrypt"]
    );

    const iv = str2ab(atob(payload.iv));
    const encryptedContent = str2ab(atob(payload.content));

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      sessionKey,
      encryptedContent
    );

    const dec = new TextDecoder();
    return dec.decode(decryptedBuffer);

  } catch (error) {
    console.error("Decryption failed detail:", error);
    return "🔒 Encrypted Message (Decryption Failed)";
  }
};
