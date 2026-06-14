import { FAQ_ITEMS } from '../lib/faq-data';

export function FAQ() {
  return (
    <section className="section faq" id="faq">
      <div className="container">
        <h2 className="faq__title">Frequently asked</h2>
        <div className="faq__list">
          {FAQ_ITEMS.map((item) => (
            <details key={item.q} className="faq__item">
              <summary>{item.q}</summary>
              <div className="faq__body">{item.a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
