export default function KovaBrand({signIn=false}:{signIn?:boolean}){
 return <div className={'kova-brand '+(signIn?'sign-in-brand':'')} aria-label="KOVA — Kayelen's Operations and Vehicle Allocation">
  <img className="kova-logo" src="/images/kova-print-logo.png" alt="Kayelen's Construction" />
  <div className="kova-lockup">
   <strong>KOVA</strong>
   <span>Kayelen&apos;s Operations and Vehicle Allocation</span>
  </div>
 </div>
}
