# By The Way Aviation Audio

Proxy seguro entre um GPT privado do ChatGPT e a API do SpeechGen.

## O que este projeto faz

- Gera um MP3 por solicitação.
- Usa `Arnold` para ATC e `Andrew` para Pilot.
- Aceita diálogos em um único áudio com tags SpeechGen:
  ```xml
  <dialog voice='Arnold'>ANAC one two three, climb and maintain flight level two eight zero.</dialog>
  <dialog voice='Andrew'>Climb and maintain flight level two eight zero, ANAC one two three.</dialog>
  ```
- Mantém a chave do SpeechGen fora do GitHub e fora do GPT.

## Como publicar no Vercel

1. Envie todos os arquivos deste projeto para um repositório privado no GitHub.
2. No Vercel, clique em **Add New → Project**.
3. Importe o repositório `by-the-way-audio`.
4. Antes do deploy, crie estas três variáveis de ambiente para **Production**, **Preview** e **Development**:
   - `SPEECHGEN_TOKEN`
   - `SPEECHGEN_EMAIL`
   - `GPT_ACTION_KEY`
5. Clique em **Deploy**.
6. Teste o endereço:
   `https://SEU-PROJETO.vercel.app/api/health`

A resposta esperada é:
```json
{
  "ok": true,
  "service": "By The Way Aviation Audio",
  "voices": {
    "atc": "Arnold",
    "pilot": "Andrew"
  }
}
```

## Como conectar ao GPT privado

1. Abra ChatGPT → Explore GPTs → Create → Configure.
2. Em **Actions**, crie uma nova Action.
3. Em autenticação, selecione **API Key/Bearer**.
4. Use como chave o mesmo valor de `GPT_ACTION_KEY`.
5. Abra `action-openapi.yaml`, substitua:
   `https://REPLACE-WITH-YOUR-VERCEL-URL`
   pelo endereço do Vercel.
6. Cole o conteúdo ajustado na Action.
7. Copie o conteúdo de `GPT-instructions.txt` para **Instructions** do GPT.
8. Salve como GPT privado.

## Teste no GPT

Peça:

> Gere o arquivo TEST_07_SITUATION_01.mp3:
>
> <dialog voice='Arnold'>ANAC one two three, climb and maintain flight level two eight zero.</dialog>
> <dialog voice='Andrew'>Climb and maintain flight level two eight zero, ANAC one two three.</dialog>

## Segurança

- Nunca inclua `SPEECHGEN_TOKEN`, `SPEECHGEN_EMAIL` ou `GPT_ACTION_KEY` no GitHub.
- Não crie um arquivo `.env` com as chaves para enviar ao repositório.
- Se uma credencial vazar, revogue-a no painel do fornecedor e crie outra.
