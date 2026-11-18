async ({ pdf, expectedCsv }) => {
  const parameters = new URLSearchParams(location.search);
  const result = (message) => location.replace(`/?stakeoutSmokeResult=${encodeURIComponent(message)}`);
  const waitFor = async (description, find) => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const value = find();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    const status = document.querySelector(".v2-workspace-status")?.textContent ?? "";
    throw new Error(`${description}: ${status}`);
  };
  const button = (text) => waitFor(text, () => Array.from(document.querySelectorAll("button"))
    .find((element) => !element.disabled && element.textContent.trim().startsWith(text)));
  const click = async (text) => (await button(text)).click();

  try {
    if (parameters.has("localProject")) {
      await click("Export");
      let downloaded;
      const createObjectUrl = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => {
        if (blob.type.startsWith("text/csv")) downloaded = blob;
        return createObjectUrl(blob);
      };
      // Capture the same Blob handed to the native download action without
      // interacting with platform-specific Save dialogs on hosted runners.
      let filename;
      const clickAnchor = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download.endsWith("-body.csv") && downloaded) {
          filename = this.download;
        } else {
          clickAnchor.call(this);
        }
      };
      await click("CSV body");
      const csv = await waitFor("stažení CSV", () => filename && downloaded);
      const actual = new Uint8Array(await csv.arrayBuffer());
      if (actual.length !== expectedCsv.length || !actual.every((value, index) => value === expectedCsv[index])) {
        throw new Error("CSV nesouhlasí s očekávanými body, výškami, pořadím nebo formátem.");
      }
      result("ok");
      return;
    }

    if (parameters.has("workspace")) {
      const input = await waitFor("výběr podkladu", () => document.querySelector('input[type="file"]'));
      const files = new DataTransfer();
      files.items.add(new File([new Uint8Array(pdf)], "synthetic.pdf", { type: "application/pdf" }));
      input.files = files.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));

      const confirm = async () => {
        await waitFor("náhled 3 bodů", () => Array.from(document.querySelectorAll("h2"))
          .some((element) => element.textContent.trim() === "3 vytěžených bodů"));
        await click("Potvrdit a vložit do modelu");
        await waitFor("potvrzení 3 bodů", () => document.querySelector(".v2-workspace-status")
          ?.textContent.includes("3 bodů bylo vloženo"));
      };
      await click("Vytěžit");
      await confirm();
      document.querySelector("#workspace-tab-files").click();
      await click("Vytěžit znovu");
      await confirm();
      await click("Otevřít 3D model");
      return;
    }

    if (parameters.get("projects") === "civil") {
      const input = await waitFor("nový projekt", () => document.querySelector(".v2-new-project input"));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "Syntetický projekt CI");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await click("Založit projekt");
      return;
    }
    await click("Inženýrská stavba");
  } catch (error) {
    result(error.message);
  }
}
