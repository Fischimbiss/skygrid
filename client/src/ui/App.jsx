import React, { useEffect, useMemo, useRef, useState } from 'react'

function Tag({children}){ return <span className="tag">{children}</span> }

export default function App(){
  const [ws, setWs] = useState(null)
  const [roomId, setRoomId] = useState('')
  const [playerId, setPlayerId] = useState(null)
  const [state, setState] = useState(null)
  const [you, setYou] = useState(null)
  const [pending, setPending] = useState(null)
  const [waitingReveal, setWaitingReveal] = useState(false)
  const nameRef = useRef(null)

  useEffect(()=>{
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const s = new WebSocket(`${proto}://${location.host}`)
    s.onmessage = ev => {
      const msg = JSON.parse(ev.data)
      if (msg.t==='created' || msg.t==='joined'){ setRoomId(msg.roomId); setPlayerId(msg.playerId) }
      if (msg.t==='state'){ setState(msg.state); setYou(msg.you) }
      if (msg.t==='drew'){ setPending(msg.card) }
    }
    setWs(s)
    return ()=> s.close()
  }, [])

  const isMyTurn = useMemo(()=>{
    const cur = state?.players?.[state?.turn]
    return cur?.id === playerId
  }, [state, playerId])

  const send = (o)=> ws && ws.readyState===1 && ws.send(JSON.stringify(o))

  const create = ()=> send({ t:'create', name: nameRef.current?.value || 'Spieler' })
  const joinPrompt = ()=> {
    const rid = prompt('Raumcode (z. B. ABC123):')?.trim().toUpperCase()
    if (rid) send({ t:'join', roomId: rid, name: nameRef.current?.value || 'Spieler' })
  }
  const start = ()=> send({ t:'start' })
  const drawDeck = ()=> { if(isMyTurn && !pending) send({ t:'drawDeck' }) }
  const takeDiscard = ()=> { if(isMyTurn && state?.discardTop!=null) setPending(state.discardTop) }
  const keep = ()=> alert('Klicke eine deiner Karten an, um zu tauschen.')
  const reject = ()=> { if (pending!=null) setWaitingReveal(true) }

  function onClickOwnCard(i, open){
    if (!isMyTurn) return
    if (pending!=null && !waitingReveal){
      if (pending === state.discardTop) send({ t:'takeDiscard', index:i })
      else send({ t:'swapWithDrawn', index:i })
      setPending(null); setWaitingReveal(false)
      return
    }
    if (waitingReveal && !open){
      send({ t:'rejectDrawn', index:i })
      setPending(null); setWaitingReveal(false)
    }
  }

  return (
    <div>
      <header>
        <div className="logo">
          <span className="logo-badge"><i className="i1"></i><i className="i2"></i><i className="i3"></i><i className="i4"></i></span>
          <span>SkyGrid</span>
        </div>
      </header>

      <main>
        {!playerId &&
          <div className="panel row">
            <input placeholder="Dein Name" ref={nameRef}/>
            <button className="btn" onClick={create}>Neues Spiel</button>
            <button className="btn secondary" onClick={joinPrompt}>Beitreten</button>
          </div>
        }

        {playerId && !state?.started &&
          <div className="panel">
            <div className="row" style={{justifyContent:'space-between'}}>
              <div>Raum: <b>{roomId}</b></div>
              <button className="btn" onClick={start}>Spiel starten</button>
            </div>
            <hr/>
            <div className="players">
              {state?.players?.map(p=>(
                <div key={p.id} className="player">
                  <b>{p.name}</b> – Gesamt: {p.total} {p.isTurn && <Tag>am Zug</Tag>}
                </div>
              ))}
            </div>
          </div>
        }

        {playerId && state?.started &&
          <div className="panel">
            <div className="row piles">
              <div className="pile" onClick={drawDeck} title="Ziehstapel">
                <div>Ziehstapel<br/><b>{state.drawCount}</b></div>
              </div>
              <div className="pile" onClick={takeDiscard} title="Ablagestapel">
                <div>Ablage<br/><b>{state.discardTop ?? '-'}</b></div>
              </div>
              <Tag>Am Zug: {state.players?.[state.turn]?.name}</Tag>
              {state.roundClosing ? <Tag>Letzte Runde</Tag> : (state.endedByIndex!=null ? <Tag>Runde schließt</Tag> : null)}
            </div>

            <h3>Deine Auslage</h3>
            <div className="grid">
              {you?.grid?.map((v,i)=>{
                const open = you?.faceUp?.includes(i)
                const pick = isMyTurn && ((pending!=null && !waitingReveal) || (!open && waitingReveal))
                return (
                  <div key={i} 
                       className={`card ${open ? `value-${v}` : 'hidden'} ${pick ? 'pick' : ''}`}
                       title={pick ? (waitingReveal? 'Aufdecken':'Tauschen') : ''}
                       onClick={()=>onClickOwnCard(i, open)}>
                    {open ? v : ''}
                  </div>
                )
              })}
            </div>

            {pending!=null &&
              <div className="row" style={{marginTop:10}}>
                <span>Gezogen: <b>{pending}</b></span>
                <button className="btn" onClick={keep}>Behalten (tauschen)</button>
                <button className="btn secondary" onClick={reject}>Ablegen & verdeckte Karte aufdecken</button>
              </div>
            }

            <h3 style={{marginTop:18}}>Mitspieler</h3>
            <div className="players">
              {state.players?.filter(p=>p.id!==playerId).map(p=>(
                <div key={p.id} className="player">
                  <div><b>{p.name}</b> – Runde: {p.scoreRound ?? 0} – Gesamt: {p.total} {p.isTurn && <Tag>am Zug</Tag>}</div>
                  <div className="grid" style={{marginTop:8}}>
                    {p.gridPublic.map((v,i)=>(
                      <div key={i} className={`card ${v==null ? 'hidden' : `value-${v}`}`}>{v ?? ''}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="footer">Tipp: Klicke auf den Ziehstapel/Ablage und dann auf eine deiner Karten, um zu tauschen.</div>
          </div>
        )}
      </main>
    </div>
  )
}