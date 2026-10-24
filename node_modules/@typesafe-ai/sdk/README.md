# TypeSafe AI JavaScript SDK

JavaScript and TypeScript SDK for [TypeSafe AI](https://typesafe.ai).

## Quickstart

Install the SDK (Node.js 22 or newer):

```sh
npm install @typesafe-ai/sdk
```

Set `TYPESAFE_API_KEY` in your environment, then create and use the client:

```ts
import { choice, TypeSafeClient } from "@typesafe-ai/sdk";

const client = new TypeSafeClient();
const response = await client.systemOne({
  state: { document: "I was charged twice. Please fix this ASAP." },
  questions: {
    category: choice("What is this ticket about?", {
      billing: null,
      technical: null,
      other: null,
    }),
  },
});

console.log(response.answers.category.choice);
```

Answer types are inferred from your questions. The package includes ESM, CommonJS, and TypeScript declarations.

## Images

Create an image with `image()` from file bytes or a `Blob` such as a `File`, or with
`Image.fromBase64()` from base64 text. Images must be PNG or JPEG; the API detects the format
from the file bytes and rejects other formats, such as WebP and GIF, with a `BadRequestError`.
There are three ways to use an image in a request, and they can be combined.

Image support is experimental. Opt in by sending the `TypeSafe-Danger-Zone-Images: true`
header:

```ts
const client = new TypeSafeClient({
  defaultHeaders: { "TypeSafe-Danger-Zone-Images": "true" },
});
```

To send it with a single request instead, pass it in the call's `headers` option.

### Place the image in the content

Put the image anywhere in `state`, question instructions, or criteria:

```ts
import { openAsBlob } from "node:fs";
import { image, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";

const client = new TypeSafeClient();
const photo = image(await openAsBlob("returns/RMA-1042.jpg"));

const { answers } = await client.systemOne({
  state: { claim: "The mug arrived with a chipped rim.", photo },
  questions: {
    damaged: noul("Is the product in the photo damaged?"),
    severity: score("How severe is the damage?", ["none", "cosmetic", "unusable"]),
  },
});
console.log(answers.damaged.noul, answers.severity.score);
```

### Write the image into text with `withAssets`

Tag a template literal with `withAssets` to reference images inside text. This route
handler checks a seller's upload against the catalog photo:

```ts
import { choice, image, noul, TypeSafeClient, withAssets } from "@typesafe-ai/sdk";
import { catalogPhotoUrl } from "./catalog";

const client = new TypeSafeClient();

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const upload = image(form.get("photo") as File);
  const catalog = image(await (await fetch(catalogPhotoUrl(String(form.get("sku"))))).blob());

  const { answers } = await client.systemOne({
    state: withAssets`A seller uploaded ${upload} for a listing whose catalog photo is ${catalog}.`,
    questions: {
      sameProduct: noul(withAssets`Does ${upload} show the same product as ${catalog}?`),
      quality: choice(withAssets`Is ${upload} usable as a listing photo?`, {
        usable: null,
        blurry: null,
        cropped: null,
        notAProduct: null,
      }),
    },
  });
  return Response.json({ sameProduct: answers.sameProduct.noul, quality: answers.quality.choice });
}
```

Each image is sent once, however many times it is used. An image in an untagged template
literal, such as `` `Compare ${upload}` ``, rejects the call with a `TypeSafeError` before the
request is sent.

To write a list of images, join it with `withAssets.join`, which works like `Array.prototype.join`:

```ts
const uploads = (form.getAll("photos") as File[]).map((file) => image(file));
const state = withAssets`The seller uploaded ${withAssets.join(uploads, ", ")}.`;
```

### Choose your own references with `assets`

Pass images in `assets`, keyed by a reference of your choice, to reference them from plain
strings, such as prompts stored in configuration:

```ts
import { readFile } from "node:fs/promises";
import { image, noul, TypeSafeClient } from "@typesafe-ai/sdk";

const client = new TypeSafeClient();

const { answers } = await client.systemOne({
  state: "A customer returned <delivered>. The catalog photo is <catalog>.",
  questions: { matches: noul("Is <delivered> the product shown in <catalog>?") },
  assets: {
    "<delivered>": image(await readFile("returns/RMA-1042.jpg")),
    "<catalog>": image(await readFile("catalog/mug.png")),
  },
});
console.log(answers.matches.noul);
```

Use distinct delimiters, such as `<delivered>`, so references don't match ordinary text.
An image in `assets` that is also placed in content or in `withAssets` text is written there as
its name. Every name in `assets` must appear in the request; otherwise the call rejects with a
`TypeSafeError` before sending.

### Locate something with `box`

Ask a `box` question to locate what its instructions describe. The answer's `box` holds the
edges as fractions of the image's height (`top`, `bottom`) and width (`left`, `right`), and its
`confidence` is `null` when the API doesn't report one. Use the `jev-preview` model for `box`
questions:

```ts
import { openAsBlob } from "node:fs";
import { box, image, TypeSafeClient } from "@typesafe-ai/sdk";

const client = new TypeSafeClient();

const { answers } = await client.systemOne({
  state: image(await openAsBlob("returns/RMA-1042.jpg")),
  questions: { damage: box("The damaged area of the product") },
  model: "jev-preview",
});
const { top, bottom, left, right } = answers.damage.box;
```

Requests with images are sent as `multipart/form-data`, with each image's file bytes in its
own part.

## Request compression

The client compresses request bodies of 1 KiB or more with zstd, which reduces upload size and
time, especially for large states. Smaller bodies fit in a single TCP segment, so they are sent
uncompressed. zstd requires Node.js 22.15 or newer; on other runtimes, all bodies are sent
uncompressed. Pass `compression: false` to send all bodies uncompressed, for example to an API
that doesn't accept compressed requests:

```ts
const client = new TypeSafeClient({ compression: false });
```

## Documentation

Learn what TypeSafe can do in the [TypeSafe docs](https://docs.typesafe.ai/).
See the SDK's [client](src/client.ts) and [types](src/types.ts) for API options and defaults.
