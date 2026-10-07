# Plugin "Anuncie com Pix"

O anunciante preenche o formulário, sobe as fotos, paga o Pix e o anúncio **publica sozinho** quando o pagamento cai. Cobrança pelo [Asaas](https://www.asaas.com/).

Instalar por **Plugins → Adicionar novo → Enviar plugin**, enviando `anuncie-pix.zip`. Configurar em **Configurações → Anuncie com Pix**.

---

## ⚠️ Antes de ligar em produção: confira a API

Os endpoints, os nomes de campo e os valores de status do Asaas estão **todos em `inc/asaas.php`**, entre marcadores `CONFERIR`. Eles foram escritos **sem acesso à documentação do Asaas** — o ambiente onde este plugin foi gerado não alcança `docs.asaas.com`.

Confira os quatro pontos em `docs.asaas.com` ou no painel (**Integrações → API**):

| # | O que conferir | O que está no código |
|---|---|---|
| 1 | URL base do sandbox | `https://api-sandbox.asaas.com/v3` — existiu também `https://sandbox.asaas.com/api/v3`. Se o primeiro teste der 404, é a outra. |
| 2 | Nome do cabeçalho da chave | `access_token` |
| 3 | Caminho do QR Code Pix | `GET /payments/{id}/pixQrCode`, devolvendo `encodedImage` e `payload` |
| 4 | Status que contam como pago | `RECEIVED`, `CONFIRMED`, `RECEIVED_IN_CASH` |

Código de pagamento escrito de memória e conferido depois não é código pronto — é rascunho que parece pronto. **Rode o fluxo inteiro em sandbox antes de trocar o ambiente.**

---

## Como o fluxo funciona

1. O anunciante abre a página com o shortcode `[anunciar]`.
2. Preenche, sobe as fotos, declara ser maior de 18 e envia.
3. O plugin cria o anúncio como **rascunho**. Nunca publicado nesta etapa.
4. Cria o cliente e a cobrança Pix no Asaas e mostra o QR Code + copia e cola.
5. O Pix cai. O Asaas chama o webhook.
6. **O webhook não acredita no que recebeu**: consulta a cobrança na API do Asaas e só publica se a própria Asaas disser que foi paga.
7. Um agendamento de hora em hora despublica o que venceu, apaga os rascunhos que nunca pagaram (com as fotos) e **resgata o Pix que caiu sem o webhook chegar**.

## Instalação, passo a passo

### 1. A chave da API vai no `wp-config.php`, não no painel

```php
define('APIX_ASAAS_CHAVE', 'sua_chave_aqui');
```

Acima da linha `That's all, stop editing`. A constante tem prioridade sobre o campo do painel. **Chave no banco vai para dentro de todo backup e de todo dump de banco** — e chave de cobrança vazada é dinheiro saindo da sua conta.

### 2. Webhook no Asaas

Em **Integrações → Webhooks**, cadastre o que o painel do plugin mostra:

- **URL:** `https://seusite.com.br/wp-json/anuncie/v1/asaas`
- **Token:** sorteado na ativação, visível no painel
- **Eventos:** `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`, `PAYMENT_REFUNDED`, `PAYMENT_CHARGEBACK_REQUESTED`

Se o webhook falhar, não é grave: de hora em hora o plugin confere na API os pendentes das últimas 72 horas e publica o que já foi pago.

### 3. A página do formulário

Crie uma página (ex. `/anunciar/`) e coloque `[anunciar]` nela. A mesma página mostra o QR Code depois do envio — não precisa de página de obrigado.

### 4. Planos

Os valores que vêm instalados (R$ 49,90 / 89,90 / 149,90) são **exemplo**. Troque pelos seus no painel. Não invento preço de serviço de ninguém.

---

## Segurança do upload

Você escolheu permitir upload **antes** do pagamento. É o cenário mais cômodo para o anunciante e o pior para o servidor: qualquer pessoa na internet grava arquivo no seu site sem se identificar e sem pagar nada. As cinco camadas, e o que cada uma de fato resolve:

| Camada | O que faz | O que ela realmente barra |
|---|---|---|
| 1 | Extensão na lista branca | o ingênuo, e só ele |
| 2 | Tipo real pelo `finfo`, lendo os bytes | `$_FILES['type']` vem do navegador, quem envia escolhe o que escrever ali |
| 3 | `getimagesize()` tem de devolver dimensão | arquivo que não é imagem de verdade |
| 4 | **Reempacotamento pelo GD** | **é esta que protege** — ver abaixo |
| 5 | `.htaccess` negando execução na pasta | rede de segurança se o servidor executar PHP dentro de uploads |

### Por que a camada 4 é a que importa

Existe arquivo que é **JPEG válido e código PHP ao mesmo tempo** (*polyglot*). Ele passa pelas camadas 1, 2 e 3 sem esforço. A camada 4 decodifica a imagem para memória e grava de novo em JPEG: entra arquivo, sai pixel. Qualquer byte estranho fica para trás.

Isso está provado em teste, não suposto. O banco de teste monta um JPEG com `<?php system($_GET['cmd'])` grudado, confirma que ele **passa** pelo `getimagesize` e pelo `finfo` como `image/jpeg`, e depois confirma que o código **não existe** na saída reempacotada.

De brinde, o reempacotamento derruba o **EXIF** — que em foto de celular carrega coordenada de GPS. Num site deste ramo, publicar o endereço de casa de quem anuncia junto com a foto não é descuido pequeno.

### Se o servidor for Nginx

Nginx **ignora `.htaccess`**. A camada 5 não existe nele. Ponha no server block:

```nginx
location ~* ^/wp-content/uploads/anuncios/.*\.(php|phar|phtml|pl|py|cgi|sh)$ {
    deny all;
}
```

### Requisitos do PHP

**GD** e **fileinfo** são obrigatórias. Sem qualquer uma das duas o upload é recusado inteiro — não há modo degradado, porque modo degradado aqui significa aceitar arquivo sem conferir. O painel mostra o estado das duas.

---

## Decisões que não são à toa

- **O webhook consulta de volta.** Um webhook é uma URL pública: qualquer pessoa pode mandar `PAYMENT_RECEIVED` para ela. Se o plugin publicasse com base no corpo recebido, anúncio de graça seria uma linha de `curl`, e no painel ficaria idêntico a uma venda. O token no cabeçalho (comparado com `hash_equals`, não `==`) só evita o trabalho; o que protege é a consulta.
- **O webhook também confere se a cobrança bate com o anúncio.** Sem isso, uma cobrança de R$ 1 com `externalReference` apontando para outro anúncio publicaria o plano caro.
- **Publicação idempotente.** O Asaas manda `PAYMENT_RECEIVED` e `PAYMENT_CONFIRMED` para a mesma cobrança, e reenvia quando não recebe `200`. Sem a trava, cada reenvio esticaria o prazo do plano.
- **Eventos que não interessam saem com `200`.** Devolver erro faz o Asaas reenviar o mesmo aviso por horas.
- **O token da URL não é o ID do post.** Com o ID na URL, trocar o número mostraria a cobrança de outro anunciante — com nome, CPF e telefone dentro.
- **O CPF não é guardado inteiro**, só os 4 últimos dígitos, o suficiente para conferir com o Asaas. O IP fica como hash. CPF completo no banco de um site de anúncio é risco sem retorno.
- **O limite por IP sobe antes de criar o rascunho**, não depois da cobrança. Se subisse depois, quem conseguisse fazer a cobrança falhar criaria rascunho e subiria foto sem limite.
- **O payload do Pix fica em meta.** Sem isso, cada recarregada da página era uma chamada à API — e o anunciante recarrega, esperando a confirmação. Várias abas estourariam o limite da conta, e aí nenhum anunciante conseguiria gerar cobrança.
- **A consulta de status do navegador lê o banco, não a API.** Uma aba aberta por uma hora faria 720 requisições.
- **Rascunho sem pagamento é apagado com as fotos** depois de 48h (configurável). Sem isso o site vira hospedagem de imagem de graça e o disco enche sem ninguém notar, porque rascunho não aparece no site.
- **Mensagem de erro neutra no formulário.** Dizer "a chave da API não está configurada" entrega a pilha do site para quem estiver olhando.
- **Declarações de 18+, de direito sobre as fotos e de termos**, com data, hora, hash do IP e user-agent registrados. Não é formalidade num site deste ramo.
- **O CPT só é registrado se não existir.** Dois registros do mesmo CPT com rótulos diferentes é briga silenciosa que termina em admin quebrado.
- **`show_in_rest` desligado** no CPT: o anúncio não precisa de API pública.
- **Desinstalar não apaga os anúncios nem as fotos.** São conteúdo pago. Perder o que o anunciante pagou porque alguém clicou em "Excluir" no plugin errado não se desfaz.

## Anti-footprint na rede

Antes de instalar no segundo site, renomeie o prefixo, a pasta, o `Plugin Name:` e **o namespace do REST** (`APIX_NS`, que aparece na URL do webhook e na consulta de status, visível no HTML):

```bash
sed -i 's/apix/xyz/g; s/APIX/XYZ/g; s#anuncie/v1#outro/v1#g' anuncie-pix.php inc/*.php uninstall.php
```

O `uninstall.php` tem os nomes das opções escritos à mão — confira que o `sed` os pegou.

## Empacotar

```bash
python3 empacota.py
```

## Testes

```bash
php teste.php
```

42 asserções sem precisar de WordPress nem da API: CPF/CNPJ pelo dígito verificador, o carimbo assinado anti-robô, o `.htaccess`, os limites, e o reempacotamento contra um polyglot real.

## Pendente

- Renovação: avisar o anunciante por e-mail antes de o plano vencer, com link para nova cobrança.
- Área do anunciante para editar o anúncio no ar sem passar por você.
- Cupom de desconto.
- Boleto e cartão além do Pix (o Asaas suporta; é trocar o `billingType` e tratar o prazo de compensação, que no boleto são dias).
