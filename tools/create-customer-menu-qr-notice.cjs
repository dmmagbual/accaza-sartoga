const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {Document,Packer,Paragraph,TextRun,ImageRun,AlignmentType,BorderStyle,ShadingType}=require('docx');
const sharp=require('sharp');

const root=path.resolve(__dirname,'..');
const outputDir=path.join(root,'docs','customer-menu-qr');
const qrUrl='https://accazacoffee.com/menu.html';

async function createQrPng(){
  const modulePath=path.join(root,'assets','js','customer','qr-encoder.mjs');
  const {default:createQr}=await import(pathToFileURL(modulePath).href);
  const qr=createQr(0,'H');
  qr.addData(qrUrl);
  qr.make();
  const svg=qr.createSvgTag({scalable:true,margin:8,alt:'Accaza customer menu QR code',title:'Accaza customer menu QR code'});
  return sharp(Buffer.from(svg)).resize(1600,1600,{kernel:'nearest'}).png().toBuffer();
}

function para(text,options={}){
  return new Paragraph({alignment:options.alignment||AlignmentType.CENTER,spacing:options.spacing||{},border:options.border,shading:options.shading,children:[new TextRun({text,bold:options.bold||false,color:options.color,font:options.font||'Aptos',size:options.size||24})]});
}

async function main(){
  fs.mkdirSync(outputDir,{recursive:true});
  const qrPng=await createQrPng();
  const qrPath=path.join(outputDir,'accaza-customer-menu-qr.png');
  const docxPath=path.join(outputDir,'Accaza_Customer_Menu_QR_Notice.docx');
  fs.writeFileSync(qrPath,qrPng);

  const green='1F4D38',gold='C58A2A',ink='1D2B24',muted='53635A';
  const divider={bottom:{color:gold,space:10,style:BorderStyle.SINGLE,size:18}};
  const document=new Document({
    creator:'Accaza Coffee House',
    title:'Accaza Customer Menu QR Notice',
    description:'Print-ready table notice for the Accaza customer menu QR code.',
    sections:[{properties:{page:{margin:{top:720,right:720,bottom:720,left:720}}},children:[
      para('ACCAZA COFFEE HOUSE',{size:25,bold:true,color:green,spacing:{after:100}}),
      para('SCAN TO VIEW OUR MENU',{size:42,bold:true,color:green,spacing:{after:120},border:divider}),
      para('Dine in at your own pace',{size:22,bold:true,color:gold,spacing:{after:55}}),
      para('Take your time. No rush, no hassle.',{size:20,color:muted,spacing:{after:260}}),
      new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:250},children:[new ImageRun({data:qrPng,type:'png',transformation:{width:330,height:330},altText:{title:'Accaza customer menu QR code',description:'Scan this code to view the Accaza menu and order for dine in.',name:'Accaza customer menu QR code'}})]}),
      para('1. Open your camera and scan the code',{size:21,color:ink,spacing:{after:85}}),
      para('2. View the menu and choose your order',{size:21,color:ink,spacing:{after:85}}),
      para('3. Enter your name and mobile number, then send your order',{size:21,color:ink,spacing:{after:85}}),
      para('4. Proceed to the cashier with your queue number for payment',{size:21,color:ink,spacing:{after:250}}),
      para('No table number is required.',{size:19,bold:true,color:green,spacing:{after:120}}),
      para(qrUrl,{size:15,color:muted,spacing:{after:0}})
    ]}]
  });
  fs.writeFileSync(docxPath,await Packer.toBuffer(document));
  console.log(docxPath);
  console.log(qrPath);
}

main().catch(error=>{console.error(error);process.exitCode=1;});
