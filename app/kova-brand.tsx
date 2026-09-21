export default function KovaBrand({signIn=false}:{signIn?:boolean}){
 return <div className={'kova-brand '+(signIn?'sign-in-brand':'')} aria-label="KOVA — Kayelen's Operations and Vehicle Allocation">
  <strong>KOVA</strong>
  <span>Kayelen&apos;s Operations and Vehicle Allocation</span>
 </div>
}
