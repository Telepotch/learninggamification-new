'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Trophy, Medal, Award, Download, Home } from 'lucide-react';
import { database } from '@/lib/firebase';
import { ref, get, onValue } from 'firebase/database';
import { Session, Participant } from '@/lib/types';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import '../print.css';

export default function ParticipantResultPage() {
  const params = useParams();
  const sessionId = params.id as string;
  
  const [session, setSession] = useState<Session | null>(null);
  const [currentParticipant, setCurrentParticipant] = useState<Participant | null>(null);
  const [allParticipants, setAllParticipants] = useState<Participant[]>([]);
  const [rank, setRank] = useState(0);
  const [previousRank, setPreviousRank] = useState(0);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const participantId = localStorage.getItem('participantId');
    if (!participantId) return;

    // セッション情報の初回取得（セッション情報は変更されないので一度だけ）
    const loadSession = async () => {
      try {
        const sessionSnapshot = await get(ref(database, `sessions/${sessionId}`));
        if (sessionSnapshot.exists()) {
          setSession(sessionSnapshot.val());
        }
      } catch (error) {
        console.error('セッション取得エラー:', error);
      }
    };
    
    loadSession();

    // 参加者情報のリアルタイム監視
    const participantsRef = ref(database, `participants/${sessionId}`);
    const unsubscribe = onValue(participantsRef, (snapshot) => {
      if (snapshot.exists()) {
        const participantsData = Object.values(snapshot.val()) as Participant[];
        
        // answersが存在しない参加者には空配列を設定
        const validatedParticipants = participantsData.map(p => ({
          ...p,
          answers: p.answers || []
        }));
        
        // スコアでソート（同点の場合は完了時刻で判定）
        validatedParticipants.sort((a, b) => {
          if (b.score !== a.score) {
            return b.score - a.score;
          }
          // 同点の場合は早く完了した方が上位
          return (a.completedAt || Infinity) - (b.completedAt || Infinity);
        });
        
        setAllParticipants(validatedParticipants);
        
        // 現在の参加者を特定
        const current = validatedParticipants.find(p => p.id === participantId);
        if (current) {
          setCurrentParticipant(current);
          // ランキングを計算
          const currentRank = validatedParticipants.findIndex(p => p.id === participantId) + 1;
          
          // 前回の順位を保存してから新しい順位を設定
          if (rank !== 0 && rank !== currentRank) {
            setPreviousRank(rank);
          }
          setRank(currentRank);
        }
      } else {
        // データが存在しない場合（最初の参加者の場合）
        // ローカルストレージから自分のデータを構築
        const participantName = localStorage.getItem('participantName');
        const participantScore = parseInt(localStorage.getItem('participantScore') || '0', 10);
        const participantAnswers = localStorage.getItem('participantAnswers');
        
        if (participantId && participantName) {
          const selfParticipant: Participant = {
            id: participantId,
            name: participantName,
            sessionId: sessionId,
            score: participantScore,
            answers: participantAnswers ? JSON.parse(participantAnswers) : [],
            completedAt: Date.now(),
            joinedAt: Date.now()
          };
          
          setCurrentParticipant(selfParticipant);
          setAllParticipants([selfParticipant]);
          setRank(1); // 最初の参加者なので1位
        }
      }
    });

    // クリーンアップ
    return () => {
      unsubscribe();
    };
  }, [sessionId, rank]);

  const getRankIcon = (position: number) => {
    switch (position) {
      case 1:
        return <Trophy className="w-6 h-6 text-yellow-500" />;
      case 2:
        return <Medal className="w-6 h-6 text-gray-400" />;
      case 3:
        return <Award className="w-6 h-6 text-orange-600" />;
      default:
        return <span className="text-gray-600 font-bold">{position}</span>;
    }
  };

  const downloadPDF = async () => {
    if (!resultRef.current || !session || !currentParticipant || !session.quizData?.questions) return;
    
    setIsGeneratingPDF(true);
    
    try {
      // PDF用の要素を作成
      const pdfContent = document.createElement('div');
      pdfContent.style.position = 'absolute';
      pdfContent.style.left = '-9999px';
      pdfContent.style.width = '800px';
      pdfContent.style.backgroundColor = 'white';
      pdfContent.style.padding = '40px';
      pdfContent.innerHTML = `
        <div style="font-family: sans-serif; color: #333;">
          <h1 style="text-align: center; color: #6B46C1; margin-bottom: 30px;">
            クイズ結果レポート
          </h1>
          
          <div style="background: #F3F4F6; padding: 20px; border-radius: 8px; margin-bottom: 30px;">
            <h2 style="font-size: 18px; margin-bottom: 15px;">参加者情報</h2>
            <p style="margin: 5px 0;"><strong>名前:</strong> ${currentParticipant.name}</p>
            <p style="margin: 5px 0;"><strong>クイズ名:</strong> ${session.quizData.title}</p>
            <p style="margin: 5px 0;"><strong>実施日:</strong> ${new Date().toLocaleDateString('ja-JP')}</p>
          </div>
          
          <div style="background: #F3F4F6; padding: 20px; border-radius: 8px; margin-bottom: 30px;">
            <h2 style="font-size: 18px; margin-bottom: 15px;">成績</h2>
            <p style="margin: 5px 0;"><strong>スコア:</strong> ${currentParticipant.score}ポイント</p>
            <p style="margin: 5px 0;"><strong>正答率:</strong> ${Math.round(
              ((currentParticipant.answers?.filter(a => a.isCorrect).length || 0) / 
              (session.quizData?.questions?.length || 0)) * 100
            )}% (${currentParticipant.answers?.filter(a => a.isCorrect).length || 0}/${(session.quizData?.questions?.length || 0)}問正解)</p>
            <p style="margin: 5px 0;"><strong>順位:</strong> ${rank}位 / ${Math.max(allParticipants.length, 1)}人中</p>
          </div>
          
          <div style="margin-bottom: 30px;">
            <h2 style="font-size: 18px; margin-bottom: 15px;">回答詳細</h2>
            ${session.quizData.questions.map((question, index) => {
              const answer = currentParticipant.answers?.[index];
              const isCorrect = answer?.isCorrect || false;
              const userAnswer = answer?.answer as number;
              
              return `
                <div style="border: 1px solid #E5E7EB; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                  <div style="margin-bottom: 10px;">
                    <strong>Q${index + 1}. ${question.question}</strong>
                    <span style="margin-left: 10px; padding: 3px 8px; border-radius: 4px; font-size: 14px; background: ${isCorrect ? '#D1FAE5' : '#FEE2E2'}; color: ${isCorrect ? '#065F46' : '#991B1B'};">
                      ${isCorrect ? '正解' : '不正解'}
                    </span>
                  </div>
                  
                  <div style="margin-left: 20px;">
                    ${question.options?.map((option, optionIndex) => {
                      const isUserAnswer = userAnswer === optionIndex;
                      const isCorrectAnswer = optionIndex === (question.correct as number);
                      
                      return `
                        <div style="margin: 5px 0; padding: 5px 10px; background: ${
                          isCorrectAnswer ? '#D1FAE5' : isUserAnswer && !isCorrect ? '#FEE2E2' : '#F9FAFB'
                        }; border-radius: 4px;">
                          ${isCorrectAnswer ? '✓' : isUserAnswer && !isCorrect ? '✗' : ''}
                          ${option}
                          ${isUserAnswer ? '(あなたの回答)' : ''}
                          ${isCorrectAnswer ? '(正解)' : ''}
                        </div>
                      `;
                    }).join('')}
                  </div>
                  
                  ${question.explanation ? `
                    <div style="margin-top: 10px; padding: 10px; background: #DBEAFE; border-radius: 4px; font-size: 14px;">
                      <strong>解説:</strong> ${question.explanation}
                    </div>
                  ` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
      
      document.body.appendChild(pdfContent);
      
      // HTML要素をキャンバスに変換
      const canvas = await html2canvas(pdfContent, {
        scale: 2,
        logging: false,
        useCORS: true
      });
      
      // PDFを生成
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });
      
      const imgWidth = 210; // A4の幅（mm）
      const pageHeight = 297; // A4の高さ（mm）
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;
      
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      
      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      
      // PDFをダウンロード
      const fileName = `quiz_result_${currentParticipant.name}_${new Date().getTime()}.pdf`;
      pdf.save(fileName);
      
      // 一時的な要素を削除
      document.body.removeChild(pdfContent);
      
    } catch (error) {
      console.error('PDF生成エラー:', error);
      alert('PDFの生成に失敗しました。');
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  if (!session || !currentParticipant || !session.quizData || !session.quizData.questions) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4"></div>
          <p className="text-gray-600">結果を読み込み中...</p>
        </div>
      </div>
    );
  }

  const correctRate = session.quizData?.questions?.length ? Math.round(
    ((currentParticipant.answers?.filter(a => a.isCorrect).length || 0) / 
    (session.quizData?.questions?.length || 0)) * 100
  ) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-100 py-8">
      <div className="container mx-auto px-4">
        <div className="max-w-2xl mx-auto" ref={resultRef}>
          {/* 結果サマリー */}
          <div className="bg-white rounded-2xl shadow-lg p-8 mb-6">
            <div className="text-center mb-6">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                クイズ完了！
              </h1>
              <p className="text-xl text-gray-600">
                お疲れさまでした、{currentParticipant.name}さん
              </p>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="text-center">
                <p className="text-sm text-gray-600 mb-1">スコア</p>
                <p className="text-3xl font-bold text-purple-600">
                  {currentParticipant.score}
                </p>
                <p className="text-sm text-gray-500">ポイント</p>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-600 mb-1">正答率</p>
                <p className="text-3xl font-bold text-green-600">
                  {correctRate}%
                </p>
                <p className="text-sm text-gray-500">
                  {currentParticipant.answers?.filter(a => a.isCorrect).length || 0}/{(session.quizData?.questions?.length || 0)}問正解
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-600 mb-1">順位</p>
                <div className="flex items-center justify-center">
                  {getRankIcon(rank)}
                  <p className="text-3xl font-bold text-gray-900 ml-2">
                    {rank}位
                  </p>
                  {previousRank !== 0 && previousRank !== rank && (
                    <span className={`ml-2 text-sm font-medium ${
                      previousRank > rank 
                        ? 'text-green-600' 
                        : 'text-red-600'
                    }`}>
                      {previousRank > rank ? '↑' : '↓'}
                      {Math.abs(previousRank - rank)}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500">
                  {Math.max(allParticipants.length, 1)}人中
                </p>
              </div>
            </div>
          </div>

          {/* 回答詳細 */}
          <div className="bg-white rounded-2xl shadow-lg p-8 mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6">
              あなたの回答結果
            </h2>
            <div className="space-y-6">
              {session.quizData?.questions?.map((question, index) => {
                const answer = currentParticipant.answers?.[index];
                const isCorrect = answer?.isCorrect || false;
                const userAnswer = answer?.answer as number;
                
                return (
                  <div key={index} className="border-2 border-gray-200 rounded-xl p-6 hover:shadow-md transition-shadow">
                    {/* 問題ヘッダー */}
                    <div className="flex items-start justify-between mb-4">
                      <h3 className="font-bold text-lg text-gray-900">
                        Q{index + 1}. {question.question}
                      </h3>
                      <div className={`px-4 py-2 rounded-lg text-sm font-bold ${
                        isCorrect 
                          ? 'bg-green-100 text-green-800 border border-green-300' 
                          : 'bg-red-100 text-red-800 border border-red-300'
                      }`}>
                        {isCorrect ? '⭕ 正解' : '❌ 不正解'}
                      </div>
                    </div>
                    
                    {/* 選択肢リスト */}
                    <div className="space-y-3">
                      {question.options?.map((option, optionIndex) => {
                        const isUserAnswer = userAnswer === optionIndex;
                        const isCorrectAnswer = optionIndex === (question.correct as number);
                        
                        // スタイルを決定
                        let bgColor = 'bg-gray-50 border-gray-200';
                        let textColor = 'text-gray-700';
                        let borderStyle = 'border';
                        let iconElement = null;
                        let label = null;
                        
                        if (isCorrectAnswer && isUserAnswer) {
                          // 正解を選択した場合
                          bgColor = 'bg-green-50 border-green-500';
                          textColor = 'text-green-900';
                          borderStyle = 'border-2';
                          iconElement = <span className="text-green-600 text-xl mr-3">✅</span>;
                          label = <span className="ml-auto text-sm font-bold text-green-600">あなたの回答（正解）</span>;
                        } else if (isCorrectAnswer) {
                          // 正解（選択していない）
                          bgColor = 'bg-green-50 border-green-400';
                          textColor = 'text-green-800';
                          borderStyle = 'border-2 border-dashed';
                          iconElement = <span className="text-green-600 text-xl mr-3">✓</span>;
                          label = <span className="ml-auto text-sm font-bold text-green-600">正解</span>;
                        } else if (isUserAnswer) {
                          // 不正解を選択した場合
                          bgColor = 'bg-red-50 border-red-400';
                          textColor = 'text-red-900';
                          borderStyle = 'border-2';
                          iconElement = <span className="text-red-600 text-xl mr-3">❌</span>;
                          label = <span className="ml-auto text-sm font-bold text-red-600">あなたの回答</span>;
                        }
                        
                        return (
                          <div 
                            key={optionIndex}
                            className={`p-4 rounded-lg ${bgColor} ${borderStyle} transition-all`}
                          >
                            <div className="flex items-center">
                              <span className="text-gray-500 font-bold mr-3 min-w-[24px]">
                                {String.fromCharCode(65 + optionIndex)}.
                              </span>
                              {iconElement}
                              <span className={`flex-1 font-medium ${textColor}`}>
                                {option}
                              </span>
                              {label}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    
                    {/* あなたの回答と正解のサマリー */}
                    {!isCorrect && userAnswer !== undefined && (
                      <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <div className="text-sm space-y-1">
                          <p className="font-semibold text-amber-900">
                            📝 あなたの回答: {String.fromCharCode(65 + userAnswer)}. {question.options?.[userAnswer]}
                          </p>
                          <p className="font-semibold text-green-800">
                            ✅ 正解: {String.fromCharCode(65 + (question.correct as number))}. {question.options?.[question.correct as number]}
                          </p>
                        </div>
                      </div>
                    )}
                    
                    {/* 解説 */}
                    {question.explanation && (
                      <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="flex items-start">
                          <span className="text-blue-600 mr-2 mt-0.5">💡</span>
                          <div>
                            <span className="font-semibold text-blue-900">解説: </span>
                            <span className="text-blue-800">{question.explanation}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ランキング */}
          <div className="bg-white rounded-2xl shadow-lg p-8 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">
                最終ランキング
              </h2>
              <div className="flex items-center text-sm text-gray-500">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse mr-2"></div>
                リアルタイム更新中
              </div>
            </div>
            <div className="space-y-3">
              {allParticipants.length > 0 ? allParticipants.slice(0, 10).map((participant, index) => (
                <div
                  key={participant.id}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    participant.id === currentParticipant.id
                      ? 'bg-purple-100 border-2 border-purple-500'
                      : 'bg-gray-50'
                  }`}
                >
                  <div className="flex items-center">
                    <div className="mr-4 w-8">
                      {getRankIcon(index + 1)}
                    </div>
                    <span className={`font-semibold ${
                      participant.id === currentParticipant.id
                        ? 'text-purple-700'
                        : 'text-gray-900'
                    }`}>
                      {participant.name}
                      {participant.id === currentParticipant.id && ' (あなた)'}
                    </span>
                  </div>
                  <div className="flex items-center">
                    <span className="text-gray-600 mr-4">
                      {participant.answers?.filter(a => a.isCorrect).length || 0}/{(session.quizData?.questions?.length || 0)}問正解
                    </span>
                    <span className="font-bold text-lg text-gray-900">
                      {participant.score}pt
                    </span>
                  </div>
                </div>
              )) : (
                <div className="text-center py-6 text-gray-500">
                  <p>まだ他の参加者がいません</p>
                  <p className="text-sm mt-1">あなたが最初の回答者です！</p>
                </div>
              )}
            </div>
          </div>

          {/* アクションボタン */}
          <div className="flex gap-4 no-print">
            <button
              onClick={downloadPDF}
              disabled={isGeneratingPDF}
              className="flex-1 bg-purple-500 text-white px-6 py-3 rounded-lg hover:bg-purple-600 transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGeneratingPDF ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                  PDF生成中...
                </>
              ) : (
                <>
                  <Download className="w-5 h-5 mr-2" />
                  結果をダウンロード (PDF)
                </>
              )}
            </button>
            <Link href="/" className="flex-1">
              <button className="w-full bg-gray-200 text-gray-700 px-6 py-3 rounded-lg hover:bg-gray-300 transition-colors flex items-center justify-center">
                <Home className="w-5 h-5 mr-2" />
                トップへ戻る
              </button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}